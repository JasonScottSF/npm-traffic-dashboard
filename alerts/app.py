"""
Alerts service — configurable alert rules with email/webhook/Slack delivery.

Checks conditions every 60 s against shared PostgreSQL data. Respects per-rule
cooldowns so the same alert doesn't fire every minute.
"""

import asyncio
import json
import os
import smtplib
import sqlite3
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import aiohttp
import asyncpg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Alerts API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _read_secret(name: str, fallback: str = None) -> str:
    """Read a secret from /run/secrets/<name>; fall back to env var with a warning."""
    try:
        return open(f"/run/secrets/{name}").read().strip()
    except FileNotFoundError:
        val = os.environ.get(name.upper(), fallback)
        if val is not None:
            print(f"[WARN] Secret '{name}' read from env — migrate to /run/secrets/", flush=True)
            return val
        raise RuntimeError(f"Secret '{name}' not found in /run/secrets/ or environment")


DATABASE_URL = os.environ["DATABASE_URL"]
SMTP_HOST    = os.environ.get("SMTP_HOST", "")
SMTP_PORT    = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER    = _read_secret("smtp_user", fallback="")
SMTP_PASS    = _read_secret("smtp_password", fallback="")
SMTP_FROM    = os.environ.get("SMTP_FROM", "") or SMTP_USER

_pool: asyncpg.Pool = None


async def _init_conn(conn: asyncpg.Connection):
    """Register JSON/JSONB codecs so Python dicts pass through transparently."""
    await conn.set_type_codec(
        "jsonb", schema="pg_catalog",
        encoder=json.dumps, decoder=json.loads,
    )
    await conn.set_type_codec(
        "json", schema="pg_catalog",
        encoder=json.dumps, decoder=json.loads,
    )


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            password=_read_secret("db_password"),
            min_size=2,
            max_size=5,
            init=_init_conn,
        )
    return _pool


# ── Schema ────────────────────────────────────────────────────────────────────

async def _ensure_schema(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS alert_channels (
                id         SERIAL PRIMARY KEY,
                name       TEXT NOT NULL,
                type       TEXT NOT NULL,
                config     JSONB NOT NULL DEFAULT '{}',
                enabled    BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS alert_rules (
                id               SERIAL PRIMARY KEY,
                name             TEXT NOT NULL,
                condition        TEXT NOT NULL,
                params           JSONB NOT NULL DEFAULT '{}',
                channel_id       INT REFERENCES alert_channels(id) ON DELETE SET NULL,
                cooldown_minutes INT NOT NULL DEFAULT 60,
                enabled          BOOLEAN NOT NULL DEFAULT TRUE,
                last_fired_at    TIMESTAMPTZ,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS alert_history (
                id           BIGSERIAL PRIMARY KEY,
                rule_id      INT REFERENCES alert_rules(id) ON DELETE SET NULL,
                rule_name    TEXT,
                fired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                message      TEXT NOT NULL,
                channel_type TEXT,
                delivered    BOOLEAN NOT NULL DEFAULT FALSE,
                error        TEXT
            )
        """)


# ── Startup / shutdown ────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    pool = await get_pool()
    await _ensure_schema(pool)
    asyncio.create_task(_alert_loop())


@app.on_event("shutdown")
async def shutdown():
    if _pool:
        await _pool.close()


# ── Condition checkers ────────────────────────────────────────────────────────

async def _check_cert_expiry(pool: asyncpg.Pool, params: dict) -> Optional[str]:
    """Fire when any tracked host's SSL cert expires within `days` days."""
    threshold = int(params.get("days", 30))
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT DISTINCT ON (host) host, ssl_days
            FROM host_uptime
            WHERE ssl_days IS NOT NULL
            ORDER BY host, ts DESC
        """)
    at_risk = [r for r in rows if r["ssl_days"] is not None and r["ssl_days"] <= threshold]
    if at_risk:
        parts = ", ".join(f"{r['host']} ({r['ssl_days']}d)" for r in sorted(at_risk, key=lambda x: x["ssl_days"]))
        return f"SSL cert expiring within {threshold} days: {parts}"
    return None


async def _check_container_down(pool: asyncpg.Pool, params: dict) -> Optional[str]:
    """Fire when any Docker container is not in 'running' state."""
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get("http://sysmon:8002/api/sys/containers") as resp:
                data = await resp.json()
    except Exception:
        return None  # sysmon unreachable — don't false-alarm

    containers = data.get("containers", [])
    # Optionally filter to a specific container name
    target = params.get("name", "").strip()
    if target:
        containers = [c for c in containers if c["name"] == target]

    down = [c for c in containers if c.get("state") != "running"]
    if down:
        names = ", ".join(c["name"] for c in down)
        return f"Container{'s' if len(down) > 1 else ''} not running: {names}"
    return None


async def _check_breach_events(pool: asyncpg.Pool, params: dict) -> Optional[str]:
    """Fire when the breach detector has >= `threshold` unacknowledged events."""
    threshold = int(params.get("threshold", 1))
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get("http://breach-detector:8090/api/breach/stats") as resp:
                data = await resp.json()
        total = data.get("total", 0)
    except Exception:
        return None

    if total >= threshold:
        return f"Breach detector: {total} WAF-bypass event{'s' if total != 1 else ''} unacknowledged"
    return None


async def _check_error_rate(pool: asyncpg.Pool, params: dict) -> Optional[str]:
    """Fire when 5xx error rate exceeds `threshold` % in the last `window_minutes` minutes."""
    threshold = float(params.get("threshold", 10.0))
    window    = int(params.get("window_minutes", 5))
    since = datetime.now(timezone.utc) - timedelta(minutes=window)

    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS errors
            FROM requests
            WHERE ts >= $1
        """, since)

    if not row or not row["total"]:
        return None

    rate = (row["errors"] / row["total"]) * 100
    if rate >= threshold:
        return (f"5xx error rate {rate:.1f}% (threshold {threshold}%) "
                f"over last {window} minutes ({row['errors']}/{row['total']} requests)")
    return None


async def _check_host_down(pool: asyncpg.Pool, params: dict) -> Optional[str]:
    """Fire when a tracked proxy host's latest probe shows an error or 5xx response."""
    target = params.get("host", "").strip()

    async with pool.acquire() as conn:
        if target:
            rows = await conn.fetch("""
                SELECT DISTINCT ON (host) host, error, status_code
                FROM host_uptime WHERE host = $1 ORDER BY host, ts DESC
            """, target)
        else:
            rows = await conn.fetch("""
                SELECT DISTINCT ON (host) host, error, status_code
                FROM host_uptime ORDER BY host, ts DESC
            """)

    down = [r for r in rows if r["error"] or (r["status_code"] and r["status_code"] >= 500)]
    if down:
        parts = []
        for r in down:
            reason = r["error"] or f"HTTP {r['status_code']}"
            parts.append(f"{r['host']} ({reason})")
        return f"Host{'s' if len(down) > 1 else ''} down: {', '.join(parts)}"
    return None


async def _check_ban_spike(pool: asyncpg.Pool, params: dict) -> Optional[str]:
    """Fire when fail2ban reports more than `threshold` IPs currently banned."""
    threshold = int(params.get("threshold", 50))
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get("http://fail2ban:8001/api/f2b/jails") as resp:
                jails = await resp.json()
    except Exception:
        return None

    total_banned = sum(
        j.get("currently_banned", 0) for j in jails
        if j.get("name") not in ("geoblock", "manual-ban")
    )
    if total_banned >= threshold:
        return f"Fail2Ban: {total_banned} IPs currently banned (threshold {threshold})"
    return None


AUTH_DB_PATH = os.environ.get("AUTH_DB_PATH", "/auth_data/auth.db")


def _query_auth_db(sql: str, params: tuple = ()) -> list:
    """Run a query against the auth SQLite database. Returns list of rows as dicts."""
    try:
        conn = sqlite3.connect(AUTH_DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        return rows
    except Exception:
        return []


async def _check_auth_failures(pool: asyncpg.Pool, params: dict) -> Optional[str]:
    """Fire when N+ failed login/MFA attempts occur in the configured window."""
    threshold      = int(params.get("threshold", 5))
    window_minutes = int(params.get("window_minutes", 10))

    loop = asyncio.get_event_loop()
    rows = await loop.run_in_executor(
        None,
        lambda: _query_auth_db(
            """
            SELECT COUNT(*) AS cnt FROM audit_log
            WHERE event IN ('LOGIN_FAILED', 'LOGIN_FAILED_MFA')
              AND ts >= datetime('now', ? || ' minutes')
            """,
            (f"-{window_minutes}",),
        ),
    )
    count = rows[0]["cnt"] if rows else 0
    if count >= threshold:
        return (
            f"Auth failures: {count} failed login/MFA attempt{'s' if count != 1 else ''} "
            f"in the last {window_minutes} minutes (threshold {threshold})"
        )
    return None


async def _check_admin_change(pool: asyncpg.Pool, params: dict) -> Optional[str]:
    """Fire when an admin account is created, invited, or deleted since lookback_minutes ago."""
    lookback = int(params.get("lookback_minutes", 60))

    loop = asyncio.get_event_loop()
    rows = await loop.run_in_executor(
        None,
        lambda: _query_auth_db(
            """
            SELECT event, username, performed_by, ts FROM audit_log
            WHERE event IN ('ADMIN_CREATED', 'INVITE_CREATED', 'USER_DELETED')
              AND ts >= datetime('now', ? || ' minutes')
            ORDER BY ts DESC
            """,
            (f"-{lookback}",),
        ),
    )
    if not rows:
        return None

    parts = []
    for r in rows:
        who  = r.get("username") or r.get("performed_by") or "unknown"
        by   = r.get("performed_by") or ""
        evt  = r["event"]
        desc = {
            "ADMIN_CREATED":  f"admin created: {who}",
            "INVITE_CREATED": f"invite created for: {who}",
            "USER_DELETED":   f"user deleted: {who}",
        }.get(evt, f"{evt}: {who}")
        if by and by != who:
            desc += f" (by {by})"
        parts.append(desc)

    return f"Admin account change{'s' if len(parts) > 1 else ''} in last {lookback}m: " + "; ".join(parts)


async def _check_backup_failed(pool: asyncpg.Pool, params: dict) -> Optional[str]:
    """Fire when the most recent backup run failed."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT ts, status, message FROM backup_status
            ORDER BY ts DESC LIMIT 1
        """)
    if not row:
        return None
    if row["status"] in ("ok", "success", "no_changes"):
        return None
    ts_str = row["ts"].strftime("%Y-%m-%d %H:%M UTC") if row["ts"] else "unknown"
    return f"Backup failed at {ts_str}: {row['message'] or 'unknown error'}"


async def _check_disk_full(pool: asyncpg.Pool, params: dict) -> Optional[str]:
    """Fire when any disk partition exceeds threshold %."""
    threshold = float(params.get("threshold", 85.0))
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get("http://sysmon:8002/api/sys/stats", timeout=aiohttp.ClientTimeout(total=5)) as r:
                data = await r.json()
        disks = data.get("disks", [])
    except Exception:
        return None
    full = [d for d in disks if d["percent"] >= threshold]
    if full:
        parts = [f"{d['mountpoint']} ({d['percent']}%)" for d in full]
        return f"Disk usage above {threshold}%: {', '.join(parts)}"
    return None


CONDITION_CHECKERS = {
    "cert_expiry":    _check_cert_expiry,
    "container_down": _check_container_down,
    "breach_events":  _check_breach_events,
    "error_rate":     _check_error_rate,
    "host_down":      _check_host_down,
    "ban_spike":      _check_ban_spike,
    "auth_failures":  _check_auth_failures,
    "admin_change":   _check_admin_change,
    "disk_full":       _check_disk_full,
    "backup_failed":   _check_backup_failed,
}

CONDITION_LABELS = {
    "cert_expiry":    "SSL Cert Expiry",
    "container_down": "Container Down",
    "breach_events":  "WAF Breach Events",
    "error_rate":     "High Error Rate",
    "host_down":      "Host Down",
    "ban_spike":      "Ban Spike",
    "auth_failures":  "Auth Failures",
    "admin_change":   "Admin Change",
    "disk_full":      "Disk Full",
    "backup_failed":  "Backup Failed",
}


# ── Alert delivery ────────────────────────────────────────────────────────────

def _send_email_sync(to: str, subject: str, body: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = SMTP_FROM
    msg["To"]      = to
    msg.attach(MIMEText(body, "plain"))
    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as srv:
            if SMTP_USER: srv.login(SMTP_USER, SMTP_PASS)
            srv.sendmail(SMTP_FROM, to, msg.as_string())
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as srv:
            srv.ehlo(); srv.starttls()
            if SMTP_USER: srv.login(SMTP_USER, SMTP_PASS)
            srv.sendmail(SMTP_FROM, to, msg.as_string())


async def _send_email_alert(config: dict, rule_name: str, message: str) -> tuple[bool, Optional[str]]:
    to = config.get("email", "").strip()
    if not to:
        return False, "No email address configured"
    if not SMTP_HOST:
        return False, "SMTP_HOST not set in environment"
    subject = f"[NPM Dashboard Alert] {rule_name}"
    body = (
        f"Alert: {rule_name}\n\n"
        f"{message}\n\n"
        f"Timestamp: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n"
        f"— NPM Dashboard Alerts"
    )
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_email_sync, to, subject, body)
        return True, None
    except Exception as e:
        return False, str(e)


async def _send_webhook_alert(config: dict, rule_name: str, message: str) -> tuple[bool, Optional[str]]:
    url = config.get("url", "").strip()
    if not url:
        return False, "No webhook URL configured"
    payload = {
        "alert":     rule_name,
        "message":   message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source":    "NPM Dashboard",
    }
    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload) as resp:
                if resp.status >= 400:
                    return False, f"HTTP {resp.status}"
                return True, None
    except Exception as e:
        return False, str(e)


async def _send_slack_alert(config: dict, rule_name: str, message: str) -> tuple[bool, Optional[str]]:
    url = config.get("url", "").strip()
    if not url:
        return False, "No Slack webhook URL configured"
    payload = {"text": f":rotating_light: *NPM Dashboard — {rule_name}*\n{message}"}
    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload) as resp:
                if resp.status >= 400:
                    return False, f"HTTP {resp.status}"
                return True, None
    except Exception as e:
        return False, str(e)


async def _deliver(channel: dict, rule_name: str, message: str) -> tuple[bool, Optional[str]]:
    ctype = channel["type"]
    cfg   = channel["config"] or {}
    if ctype == "email":
        return await _send_email_alert(cfg, rule_name, message)
    if ctype == "webhook":
        return await _send_webhook_alert(cfg, rule_name, message)
    if ctype == "slack":
        return await _send_slack_alert(cfg, rule_name, message)
    return False, f"Unknown channel type: {ctype}"


# ── Alert loop ────────────────────────────────────────────────────────────────

async def _run_checks():
    pool = await get_pool()
    now  = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        rules = await conn.fetch("""
            SELECT r.*,
                   c.type    AS ch_type,
                   c.config  AS ch_config,
                   c.enabled AS ch_enabled
            FROM alert_rules r
            LEFT JOIN alert_channels c ON r.channel_id = c.id
            WHERE r.enabled = TRUE
        """)

    for rule in rules:
        # Respect cooldown
        if rule["last_fired_at"]:
            cooldown_end = rule["last_fired_at"] + timedelta(minutes=rule["cooldown_minutes"])
            if now < cooldown_end:
                continue

        checker = CONDITION_CHECKERS.get(rule["condition"])
        if not checker:
            continue

        params = rule["params"] or {}

        try:
            message = await checker(pool, params)
        except Exception as e:
            print(f"[alerts] check error rule={rule['id']} ({rule['name']}): {e}")
            continue

        if not message:
            continue

        # Deliver
        delivered, err = False, None
        ch_type = rule["ch_type"]
        if rule["channel_id"] and rule["ch_enabled"]:
            channel = {"type": rule["ch_type"], "config": rule["ch_config"]}
            delivered, err = await _deliver(channel, rule["name"], message)

        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO alert_history (rule_id, rule_name, message, channel_type, delivered, error)
                VALUES ($1, $2, $3, $4, $5, $6)
            """, rule["id"], rule["name"], message, ch_type, delivered, err)
            await conn.execute(
                "UPDATE alert_rules SET last_fired_at = NOW() WHERE id = $1", rule["id"]
            )

        status = "delivered" if delivered else f"failed ({err})"
        print(f"[alerts] fired rule={rule['id']} ({rule['name']}) — {status}")


async def _alert_loop():
    await asyncio.sleep(30)  # brief startup delay
    while True:
        try:
            await _run_checks()
        except Exception as e:
            print(f"[alerts] loop error: {e}")
        await asyncio.sleep(60)


# ── REST API ──────────────────────────────────────────────────────────────────

# Channels

class ChannelIn(BaseModel):
    name:    str
    type:    str       # email | webhook | slack
    config:  dict = {}
    enabled: bool = True


@app.get("/api/alerts/channels")
async def list_channels():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM alert_channels ORDER BY id")
    return [dict(r) for r in rows]


@app.post("/api/alerts/channels", status_code=201)
async def create_channel(ch: ChannelIn):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO alert_channels (name, type, config, enabled)
            VALUES ($1, $2, $3, $4) RETURNING *
        """, ch.name, ch.type, ch.config, ch.enabled)
    return dict(row)


@app.put("/api/alerts/channels/{cid}")
async def update_channel(cid: int, ch: ChannelIn):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE alert_channels SET name=$1, type=$2, config=$3, enabled=$4
            WHERE id=$5 RETURNING *
        """, ch.name, ch.type, ch.config, ch.enabled, cid)
    if not row:
        raise HTTPException(404, "Channel not found")
    return dict(row)


@app.delete("/api/alerts/channels/{cid}")
async def delete_channel(cid: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM alert_channels WHERE id=$1", cid)
    return {"ok": True}


@app.post("/api/alerts/channels/{cid}/test")
async def test_channel(cid: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM alert_channels WHERE id=$1", cid)
    if not row:
        raise HTTPException(404, "Channel not found")
    channel = {"type": row["type"], "config": row["config"] or {}}
    delivered, error = await _deliver(channel, "Test Alert", "This is a test alert from NPM Dashboard. Your channel is working correctly.")
    return {"delivered": delivered, "error": error}


@app.get("/api/alerts/smtp-config")
async def smtp_config():
    """Return current SMTP settings (password redacted) so the UI can show them."""
    return {
        "host":      SMTP_HOST or None,
        "port":      SMTP_PORT,
        "user":      SMTP_USER or None,
        "from_addr": SMTP_FROM or None,
        "configured": bool(SMTP_HOST),
    }


class SmtpTestRequest(BaseModel):
    to: str

@app.post("/api/alerts/smtp-test")
async def smtp_test(req: SmtpTestRequest):
    """Send a raw test email to verify SMTP settings, independent of any saved channel."""
    to = req.to.strip()
    if not to:
        raise HTTPException(400, "No recipient address provided")
    delivered, error = await _send_email_alert({"email": to}, "SMTP Test", (
        "This is a test email from NPM Dashboard.\n\n"
        f"SMTP host: {SMTP_HOST}:{SMTP_PORT}\n"
        f"Sent from: {SMTP_FROM}\n\n"
        "If you received this, your email settings are working correctly."
    ))
    return {"delivered": delivered, "error": error}


# Rules

class RuleIn(BaseModel):
    name:             str
    condition:        str
    params:           dict = {}
    channel_id:       Optional[int] = None
    cooldown_minutes: int  = 60
    enabled:          bool = True


@app.get("/api/alerts/rules")
async def list_rules():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT r.*, c.name AS channel_name, c.type AS channel_type
            FROM alert_rules r
            LEFT JOIN alert_channels c ON r.channel_id = c.id
            ORDER BY r.id
        """)
    return [dict(r) for r in rows]


@app.post("/api/alerts/rules", status_code=201)
async def create_rule(rule: RuleIn):
    if rule.condition not in CONDITION_CHECKERS:
        raise HTTPException(400, f"Unknown condition '{rule.condition}'. Valid: {list(CONDITION_CHECKERS)}")
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO alert_rules (name, condition, params, channel_id, cooldown_minutes, enabled)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
        """, rule.name, rule.condition, rule.params, rule.channel_id,
            rule.cooldown_minutes, rule.enabled)
    return dict(row)


@app.put("/api/alerts/rules/{rid}")
async def update_rule(rid: int, rule: RuleIn):
    if rule.condition not in CONDITION_CHECKERS:
        raise HTTPException(400, f"Unknown condition '{rule.condition}'")
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE alert_rules
            SET name=$1, condition=$2, params=$3, channel_id=$4,
                cooldown_minutes=$5, enabled=$6
            WHERE id=$7 RETURNING *
        """, rule.name, rule.condition, rule.params, rule.channel_id,
            rule.cooldown_minutes, rule.enabled, rid)
    if not row:
        raise HTTPException(404, "Rule not found")
    return dict(row)


@app.delete("/api/alerts/rules/{rid}")
async def delete_rule(rid: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM alert_rules WHERE id=$1", rid)
    return {"ok": True}


@app.post("/api/alerts/rules/{rid}/fire-now")
async def fire_now(rid: int):
    """Reset the cooldown timer so this rule will fire on the next check cycle."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("UPDATE alert_rules SET last_fired_at = NULL WHERE id=$1", rid)
    return {"ok": True}


@app.post("/api/alerts/rules/{rid}/check-now")
async def check_now(rid: int):
    """
    Immediately evaluate this rule's condition (ignoring cooldown).
    If the condition is met, fire the alert and record it in history.
    Returns the result so the UI can show it inline.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        rule = await conn.fetchrow("""
            SELECT r.*,
                   c.type    AS ch_type,
                   c.config  AS ch_config,
                   c.enabled AS ch_enabled
            FROM alert_rules r
            LEFT JOIN alert_channels c ON r.channel_id = c.id
            WHERE r.id = $1
        """, rid)

    if not rule:
        raise HTTPException(404, "Rule not found")

    checker = CONDITION_CHECKERS.get(rule["condition"])
    if not checker:
        raise HTTPException(400, f"Unknown condition: {rule['condition']}")

    params = rule["params"] or {}
    try:
        message = await checker(pool, params)
    except Exception as e:
        return {"condition_met": False, "message": None, "delivered": False, "error": str(e)}

    if not message:
        return {"condition_met": False, "message": "Condition not met — no alert would fire", "delivered": False, "error": None}

    # Condition met — deliver and record
    delivered, err = False, None
    if rule["channel_id"] and rule["ch_enabled"]:
        channel = {"type": rule["ch_type"], "config": rule["ch_config"] or {}}
        delivered, err = await _deliver(channel, rule["name"], message)

    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO alert_history (rule_id, rule_name, message, channel_type, delivered, error)
            VALUES ($1, $2, $3, $4, $5, $6)
        """, rule["id"], rule["name"], message, rule["ch_type"], delivered, err)
        await conn.execute(
            "UPDATE alert_rules SET last_fired_at = NOW() WHERE id = $1", rule["id"]
        )

    return {
        "condition_met": True,
        "message":       message,
        "delivered":     delivered,
        "error":         err,
    }


# History

@app.get("/api/alerts/history")
async def get_history(limit: int = 100):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM alert_history ORDER BY fired_at DESC LIMIT $1
        """, limit)
    return [
        {**dict(r), "fired_at": r["fired_at"].isoformat()}
        for r in rows
    ]


# Meta

@app.get("/api/alerts/conditions")
async def list_conditions():
    """Available condition types with labels."""
    return [{"value": k, "label": v} for k, v in CONDITION_LABELS.items()]


@app.get("/health")
async def health():
    return {"status": "ok"}
