import os
import re
import json
import ipaddress
import subprocess
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Fail2Ban API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SOCKET        = Path("/var/run/fail2ban/fail2ban.sock")
F2B_LOG       = Path(os.environ.get("F2B_LOG", "/f2b_data/fail2ban.log"))
JAIL_LOCAL    = Path("/etc/fail2ban/jail.local")
JAIL_D        = Path("/etc/fail2ban/jail.d")
GEO_DB                  = JAIL_D / "blocked_countries.json"
GEO_REFRESH_STATE       = JAIL_D / "geo_refresh_state.json"
GEO_JAIL                = "geoblock"
GEO_BATCH               = 50
GEO_REFRESH_INTERVAL    = int(os.environ.get("GEO_REFRESH_DAYS", "7")) * 86400
GEOIP_PATH    = Path(os.environ.get("GEOIP_DB", "/geoip/GeoLite2-Country.mmdb"))
MANUAL_JAIL   = "manual-ban"
MANUAL_DB     = JAIL_D / "manual_bans.json"

_geoip_reader = None

def _get_geoip():
    global _geoip_reader
    if _geoip_reader is None and GEOIP_PATH.exists():
        try:
            import geoip2.database
            _geoip_reader = geoip2.database.Reader(str(GEOIP_PATH))
        except Exception:
            pass
    return _geoip_reader

def _lookup_country(ip: str) -> str:
    reader = _get_geoip()
    if not reader:
        return ""
    try:
        return reader.country(ip).country.iso_code or ""
    except Exception:
        return ""


def f2b(*args, timeout=10):
    try:
        r = subprocess.run(
            ["fail2ban-client", "-s", str(SOCKET)] + list(args),
            capture_output=True, text=True, timeout=timeout
        )
        return r.returncode == 0, r.stdout.strip(), r.stderr.strip()
    except FileNotFoundError:
        return False, "", "fail2ban-client not found"
    except subprocess.TimeoutExpired:
        return False, "", "timeout"
    except Exception as e:
        return False, "", str(e)


def parse_jail_status(raw: str) -> dict:
    def extract(pattern, text, cast=str, default=None):
        m = re.search(pattern, text)
        return cast(m.group(1).strip()) if m else default

    banned_str = extract(r"Banned IP list:\s*(.*?)$", raw, str, "")
    banned_ips = [ip.strip() for ip in banned_str.split() if ip.strip()] if banned_str else []

    return {
        "currently_failed": extract(r"Currently failed:\s*(\d+)", raw, int, 0),
        "total_failed":     extract(r"Total failed:\s*(\d+)", raw, int, 0),
        "currently_banned": extract(r"Currently banned:\s*(\d+)", raw, int, 0),
        "total_banned":     extract(r"Total banned:\s*(\d+)", raw, int, 0),
        "banned_ips":       banned_ips,
        "file_list":        extract(r"File list:\s*(.*?)$", raw, str, ""),
    }


@app.get("/api/f2b/status")
def status():
    ok, out, err = f2b("ping")
    running = ok and "pong" in out.lower()

    if not running:
        return {"running": False, "jails": [], "total_banned": 0, "total_failed": 0, "error": err}

    ok2, out2, _ = f2b("status")
    jail_list = []
    if ok2:
        m = re.search(r"Jail list:\s*(.+)", out2)
        if m:
            jail_list = [j.strip() for j in m.group(1).split(",") if j.strip()]

    return {
        "running": True,
        "jails": jail_list,
        "jail_count": len(jail_list),
        "socket": str(SOCKET),
    }


# ── Ban history (parsed from log) ─────────────────────────────────────────────
# Cache so we don't re-scan the full log on every /api/f2b/jails poll.
_ban_history_cache: dict = {}          # ip → {banned_at, ban_count, jails}
_ban_history_ts:    float = 0.0
_BAN_HISTORY_TTL    = 60               # seconds

LOG_RE = re.compile(
    r"(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ "
    r"fail2ban\.(?P<component>\w+)\s+\[\d+\]: (?P<level>\w+)\s+"
    r"(?:\[(?P<jail>[^\]]+)\] )?(?P<message>.+)"
)
BAN_RE  = re.compile(r"Ban\s+(\S+)")
UNBAN_RE= re.compile(r"Unban\s+(\S+)")

def _build_ban_history() -> dict:
    """
    Scan the fail2ban log and return a dict keyed by IP:
      { ip: { banned_at: str, ban_count: int, jails: [str] } }
    Only tracks IPs that have a Ban entry newer than the most recent Unban.
    """
    global _ban_history_cache, _ban_history_ts
    now = time.time()
    if now - _ban_history_ts < _BAN_HISTORY_TTL:
        return _ban_history_cache

    if not F2B_LOG.exists():
        return {}

    try:
        raw = subprocess.run(
            ["tail", "-n", "50000", str(F2B_LOG)],
            capture_output=True, text=True
        ).stdout.splitlines()
    except Exception:
        return {}

    # ip → list of (ts_str, event, jail)  where event is 'ban' or 'unban'
    events: dict[str, list] = {}
    for line in raw:
        m = LOG_RE.match(line)
        if not m:
            continue
        msg  = m.group("message") or ""
        jail = m.group("jail") or ""
        ts   = m.group("ts")
        bm = BAN_RE.match(msg)
        if bm:
            ip = bm.group(1)
            events.setdefault(ip, []).append((ts, "ban", jail))
            continue
        um = UNBAN_RE.match(msg)
        if um:
            ip = um.group(1)
            events.setdefault(ip, []).append((ts, "unban", jail))

    result = {}
    for ip, evlist in events.items():
        bans   = [(ts, j) for ts, ev, j in evlist if ev == "ban"]
        unbans = [(ts, j) for ts, ev, j in evlist if ev == "unban"]
        if not bans:
            continue
        latest_ban   = max(bans,   key=lambda x: x[0])
        latest_unban = max(unbans, key=lambda x: x[0]) if unbans else ("", "")
        # Only include if currently banned (latest event is a ban)
        if latest_unban[0] and latest_unban[0] > latest_ban[0]:
            continue
        result[ip] = {
            "banned_at": latest_ban[0],
            "ban_count": len(bans),
            "jails":     list({j for _, j in bans if j}),
        }

    _ban_history_cache = result
    _ban_history_ts    = now
    return result


def _jail_ban_log(jail_name: str) -> list:
    """
    Return every Ban event for a specific jail from the log, newest first.
    Each entry: { ip, ts, status }  where status is 'banned' or 'unbanned'.
    """
    if not F2B_LOG.exists():
        return []
    try:
        raw = subprocess.run(
            ["tail", "-n", "50000", str(F2B_LOG)],
            capture_output=True, text=True
        ).stdout.splitlines()
    except Exception:
        return []

    # Collect all ban/unban events for this jail in order
    events = []
    for line in raw:
        m = LOG_RE.match(line)
        if not m or m.group("jail") != jail_name:
            continue
        msg = m.group("message") or ""
        ts  = m.group("ts")
        bm = BAN_RE.match(msg)
        if bm:
            events.append({"ip": bm.group(1), "ts": ts, "event": "ban"})
            continue
        um = UNBAN_RE.match(msg)
        if um:
            events.append({"ip": um.group(1), "ts": ts, "event": "unban"})

    # Determine current status per IP (last event wins)
    status: dict[str, str] = {}
    for ev in events:
        status[ev["ip"]] = ev["event"]

    # Return all Ban events newest-first, annotated with current status
    bans = [e for e in reversed(events) if e["event"] == "ban"]
    return [
        {
            "ip":      e["ip"],
            "ts":      e["ts"],
            "status":  status.get(e["ip"], "banned"),  # 'banned' or 'unban'
            "country": _lookup_country(e["ip"]),
        }
        for e in bans
    ]


def _parse_curfails(name: str) -> list:
    # The `get <jail> curfails` subcommand is not supported by the
    # crazymax/fail2ban image (1.1.0).  Calling it causes the fail2ban daemon
    # to write ERROR entries to its log on every poll.  Return empty list
    # until a version that supports it is available.
    return []


@app.get("/api/f2b/jails")
def jails():
    ok, out, err = f2b("status")
    if not ok:
        raise HTTPException(503, detail=f"fail2ban unavailable: {err}")

    m = re.search(r"Jail list:\s*(.+)", out)
    jail_names = [j.strip() for j in m.group(1).split(",")] if m else []

    ban_history = _build_ban_history()

    result = []
    for name in jail_names:
        ok2, out2, _ = f2b("status", name)
        if ok2:
            data = parse_jail_status(out2)
            data["name"] = name
            data["banned_ips"] = [
                {
                    "ip":        ip,
                    "country":   _lookup_country(ip),
                    "banned_at": ban_history.get(ip, {}).get("banned_at"),
                    "ban_count": ban_history.get(ip, {}).get("ban_count", 1),
                }
                for ip in data["banned_ips"]
            ]
            data["failing_ips"] = _parse_curfails(name)
            result.append(data)

    return result


@app.get("/api/f2b/jails/{name}/ban_history")
def jail_ban_history(name: str):
    """All ban events for a jail from the log, newest first, with current status."""
    return _jail_ban_log(name)


@app.get("/api/f2b/jail/{name}")
def jail_detail(name: str):
    ok, out, err = f2b("status", name)
    if not ok:
        raise HTTPException(404, detail=f"Jail '{name}' not found: {err}")
    data = parse_jail_status(out)
    data["name"] = name
    return data


class UnbanRequest(BaseModel):
    jail: str
    ip: str


@app.post("/api/f2b/unban")
def unban(req: UnbanRequest):
    ok, out, err = f2b("set", req.jail, "unbanip", req.ip)
    if not ok:
        raise HTTPException(400, detail=f"Unban failed: {err or out}")
    return {"success": True, "jail": req.jail, "ip": req.ip}


@app.post("/api/f2b/ban")
def ban(req: UnbanRequest):
    ok, out, err = f2b("set", req.jail, "banip", req.ip)
    if not ok:
        raise HTTPException(400, detail=f"Ban failed: {err or out}")
    return {"success": True, "jail": req.jail, "ip": req.ip}


@app.get("/api/f2b/log")
def log(lines: int = 200, jail: str = ""):
    if not F2B_LOG.exists():
        return []

    try:
        raw = subprocess.run(
            ["tail", "-n", str(lines * 2), str(F2B_LOG)],
            capture_output=True, text=True
        ).stdout.splitlines()
    except Exception:
        return []

    events = []
    for line in raw:
        m = LOG_RE.match(line)
        if not m:
            continue
        entry = m.groupdict()
        if jail and entry.get("jail") != jail:
            continue
        events.append(entry)

    return list(reversed(events[-lines:]))


@app.get("/api/f2b/banned")
def all_banned():
    ok, out, _ = f2b("status")
    if not ok:
        return []

    m = re.search(r"Jail list:\s*(.+)", out)
    jail_names = [j.strip() for j in m.group(1).split(",")] if m else []

    result = []
    for name in jail_names:
        ok2, out2, _ = f2b("status", name)
        if ok2:
            data = parse_jail_status(out2)
            for ip in data["banned_ips"]:
                result.append({"jail": name, "ip": ip})

    return result


# ── Jail management ──────────────────────────────────────────────────────────

CANNED_JAILS = {
    "sshd": {
        "name": "sshd",
        "description": "Block brute-force SSH login attempts",
        "filter": "sshd",
        "logpath": "/host-logs/auth.log",
        "port": "ssh",
        "maxretry": 3,
        "findtime": "10m",
        "bantime": "24h",
        "backend": "auto",
    },
    "npm-http-auth": {
        "name": "npm-http-auth",
        "description": "Block repeated 401 Unauthorized on NPM proxied hosts",
        "filter": "npm-http-auth",
        "logpath": "/npm_logs/proxy-host-*_access.log\n           /npm_logs/default-host_access.log",
        "port": "http,https",
        "maxretry": 10,
        "findtime": "5m",
        "bantime": "30m",
        "backend": "auto",
    },
    "npm-badbots": {
        "name": "npm-badbots",
        "description": "Block known scanners and exploit tools (nikto, nmap, sqlmap, etc.)",
        "filter": "npm-badbots",
        "logpath": "/npm_logs/proxy-host-*_access.log\n           /npm_logs/default-host_access.log",
        "port": "http,https",
        "maxretry": 2,
        "findtime": "1m",
        "bantime": "24h",
        "backend": "auto",
    },
    "npm-404": {
        "name": "npm-404",
        "description": "Block IPs repeatedly hitting non-existent pages (404 scanners)",
        "filter": "npm-404",
        "logpath": "/npm_logs/proxy-host-*_access.log\n           /npm_logs/default-host_access.log\n           /npm_logs/fallback_http_access.log",
        "port": "http,https",
        "maxretry": 10,
        "findtime": "2m",
        "bantime": "1h",
        "backend": "auto",
    },
    "recidive": {
        "name": "recidive",
        "description": "Long-term ban for repeat offenders across all jails",
        "filter": "recidive",
        "logpath": "/data/fail2ban.log",
        "port": "all",
        "maxretry": 5,
        "findtime": "1d",
        "bantime": "7d",
        "backend": "polling",
    },
}


def _write_jail_config(jail_name: str, config: dict) -> str:
    lines = [f"[{jail_name}]", "enabled = true"]
    for key in ("filter", "logpath", "port", "maxretry", "findtime", "bantime", "backend"):
        if key in config and config[key] is not None:
            lines.append(f"{key} = {config[key]}")
    if config.get("action"):
        lines.append(f"action = {config['action']}")
    return "\n".join(lines) + "\n"


@app.get("/api/f2b/canned_jails")
def canned_jails():
    return list(CANNED_JAILS.values())


class JailConfig(BaseModel):
    name: str
    filter: str
    logpath: str
    port: str = "http,https"
    maxretry: int = 5
    findtime: str = "10m"
    bantime: str = "1h"
    backend: str = "auto"
    action: str = ""


def reload_jail(name: str) -> tuple[bool, str]:
    """Reload a specific jail; fall back to full reload. Returns (ok, warning_or_empty)."""
    ok, _, err = f2b("reload", name)
    if ok:
        return True, ""
    # Specific jail reload failed — try full reload
    ok2, _, err2 = f2b("reload")
    if ok2:
        return True, ""
    return False, err2 or err


@app.post("/api/f2b/jail/create")
def create_jail(cfg: JailConfig):
    name = re.sub(r"[^a-z0-9_-]", "", cfg.name.lower())
    if not name:
        raise HTTPException(400, "Invalid jail name")

    jail_file = JAIL_D / f"{name}.local"
    content = _write_jail_config(name, cfg.dict())

    try:
        JAIL_D.mkdir(parents=True, exist_ok=True)
        jail_file.write_text(content)
    except Exception as e:
        raise HTTPException(500, f"Could not write jail config: {e}")

    ok, warning = reload_jail(name)
    if not ok:
        return {"success": False, "warning": f"Config written but reload failed: {warning}. Restart fail2ban to apply."}

    return {"success": True, "jail": name, "file": str(jail_file)}


@app.delete("/api/f2b/jail/{name}")
def delete_jail(name: str):
    jail_file = JAIL_D / f"{name}.local"
    if not jail_file.exists():
        raise HTTPException(404, f"No managed jail config found for '{name}'")
    try:
        jail_file.unlink()
    except Exception as e:
        raise HTTPException(500, f"Could not remove jail config: {e}")

    f2b("reload")
    return {"success": True, "jail": name}


@app.get("/api/f2b/jail/{name}/config")
def jail_config(name: str):
    jail_file = JAIL_D / f"{name}.local"
    if not jail_file.exists():
        return {"managed": False, "content": ""}
    return {"managed": True, "content": jail_file.read_text()}


class RawJailConfig(BaseModel):
    name: str
    content: str


@app.put("/api/f2b/jail/raw")
def update_jail_raw(cfg: RawJailConfig):
    name = re.sub(r"[^a-z0-9_-]", "", cfg.name.lower())
    if not name:
        raise HTTPException(400, "Invalid jail name")
    jail_file = JAIL_D / f"{name}.local"
    try:
        JAIL_D.mkdir(parents=True, exist_ok=True)
        jail_file.write_text(cfg.content)
    except Exception as e:
        raise HTTPException(500, str(e))
    ok, warning = reload_jail(name)
    if not ok:
        return {"success": False, "warning": f"Config written but reload failed: {warning}"}
    return {"success": True}


# ── Country / GeoBlock ────────────────────────────────────────────────────────

def _load_geo_db() -> dict:
    if GEO_DB.exists():
        try:
            return json.loads(GEO_DB.read_text())
        except Exception:
            pass
    return {}


def _save_geo_db(data: dict):
    GEO_DB.write_text(json.dumps(data))


def _fetch_cidrs(cc: str) -> list[str]:
    url = f"https://www.ipdeny.com/ipblocks/data/aggregated/{cc.lower()}-aggregated.zone"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "npm-dashboard/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return [line.strip() for line in r.read().decode().splitlines() if line.strip()]
    except Exception as e:
        raise HTTPException(502, f"Could not fetch CIDRs for {cc}: {e}")


def _banip_batch(cidrs: list[str]):
    for i in range(0, len(cidrs), GEO_BATCH):
        f2b("set", GEO_JAIL, "banip", *cidrs[i:i + GEO_BATCH])


def _unbanip_batch(cidrs: list[str]):
    for i in range(0, len(cidrs), GEO_BATCH):
        f2b("set", GEO_JAIL, "unbanip", *cidrs[i:i + GEO_BATCH])


def _fetch_cidrs_safe(cc: str) -> list[str]:
    """Like _fetch_cidrs but returns [] instead of raising — safe for background use."""
    url = f"https://www.ipdeny.com/ipblocks/data/aggregated/{cc.lower()}-aggregated.zone"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "npm-dashboard/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return [line.strip() for line in r.read().decode().splitlines() if line.strip()]
    except Exception as e:
        print(f"[geo-refresh] failed to fetch CIDRs for {cc}: {e}")
        return []


def _geo_refresh_all(reason: str = "scheduled") -> dict:
    """Re-fetch CIDR lists for every blocked country and apply a diff.
    Only touches rules that actually changed — no gap window."""
    db = _load_geo_db()
    if not db:
        return {"refreshed": 0, "skipped": 0, "reason": reason}

    results = []
    for cc, old_cidrs in list(db.items()):
        new_cidrs = _fetch_cidrs_safe(cc)
        if not new_cidrs:
            results.append({"cc": cc, "status": "fetch_failed"})
            continue
        old_set = set(old_cidrs)
        new_set = set(new_cidrs)
        to_remove = list(old_set - new_set)
        to_add    = list(new_set - old_set)
        if to_remove:
            _unbanip_batch(to_remove)
        if to_add:
            _banip_batch(to_add)
        db[cc] = new_cidrs
        results.append({
            "cc":      cc,
            "status":  "ok",
            "added":   len(to_add),
            "removed": len(to_remove),
            "total":   len(new_cidrs),
        })

    _save_geo_db(db)
    state = {
        "last_refreshed": datetime.now(timezone.utc).isoformat(),
        "reason":         reason,
        "results":        results,
    }
    try:
        GEO_REFRESH_STATE.write_text(json.dumps(state))
    except Exception:
        pass
    print(f"[geo-refresh] {reason}: refreshed {len(results)} countries")
    return state


def _geo_refresh_loop():
    """Daemon thread: refresh geo-block CIDRs on the configured interval."""
    # Stagger first run so it doesn't race fail2ban startup
    time.sleep(300)
    while True:
        try:
            _geo_refresh_all("scheduled")
        except Exception as e:
            print(f"[geo-refresh] unhandled error: {e}")
        time.sleep(GEO_REFRESH_INTERVAL)


@app.on_event("startup")
def startup():
    t = threading.Thread(target=_geo_refresh_loop, daemon=True, name="geo-refresh")
    t.start()
    print(f"[geo-refresh] scheduler started — interval {GEO_REFRESH_INTERVAL // 86400}d")


@app.delete("/api/f2b/geo/block")
def geo_unblock_all():
    db = _load_geo_db()
    # Reload the jail to flush all iptables rules, then clear the DB
    f2b("reload", GEO_JAIL)
    _save_geo_db({})
    return {"success": True, "cleared": len(db)}


@app.get("/api/f2b/geo/blocked")
def geo_blocked():
    db = _load_geo_db()
    last_refreshed = None
    try:
        if GEO_REFRESH_STATE.exists():
            last_refreshed = json.loads(GEO_REFRESH_STATE.read_text()).get("last_refreshed")
    except Exception:
        pass
    return {
        "countries":     [{"country_code": cc, "cidr_count": len(v)} for cc, v in db.items()],
        "last_refreshed": last_refreshed,
    }


@app.post("/api/f2b/geo/refresh")
def geo_refresh():
    """Manually trigger a CIDR refresh for all blocked countries."""
    db = _load_geo_db()
    if not db:
        return {"refreshed": 0, "message": "No countries currently blocked"}
    result = _geo_refresh_all("manual")
    return result


class GeoBlockRequest(BaseModel):
    country_code: str


@app.post("/api/f2b/geo/block")
def geo_block(req: GeoBlockRequest):
    cc = req.country_code.upper().strip()
    if len(cc) != 2 or not cc.isalpha():
        raise HTTPException(400, "country_code must be a 2-letter ISO code")

    db = _load_geo_db()
    if cc in db:
        raise HTTPException(409, f"{cc} is already blocked")

    cidrs = _fetch_cidrs(cc)
    if not cidrs:
        raise HTTPException(404, f"No IP ranges found for {cc}")

    _banip_batch(cidrs)
    db[cc] = cidrs
    _save_geo_db(db)
    return {"success": True, "country_code": cc, "cidrs": len(cidrs)}


@app.delete("/api/f2b/geo/block/{country_code}")
def geo_unblock(country_code: str):
    cc = country_code.upper()
    db = _load_geo_db()
    if cc not in db:
        raise HTTPException(404, f"{cc} is not blocked")

    del db[cc]
    _save_geo_db(db)

    # Reload the jail to flush all bans, then re-apply remaining countries
    f2b("reload", GEO_JAIL)
    for cidrs in db.values():
        _banip_batch(cidrs)

    return {"success": True, "country_code": cc}


# ── Manual IP / CIDR ban ──────────────────────────────────────────────────────

def _load_manual_db() -> list:
    if MANUAL_DB.exists():
        try:
            return json.loads(MANUAL_DB.read_text())
        except Exception:
            pass
    return []


def _save_manual_db(ips: list):
    MANUAL_DB.write_text(json.dumps(ips))


@app.get("/api/f2b/manual/banned")
def manual_banned():
    return _load_manual_db()


class ManualBanRequest(BaseModel):
    ip: str


@app.post("/api/f2b/manual/ban")
def manual_ban(req: ManualBanRequest):
    ip = req.ip.strip()
    try:
        ipaddress.ip_network(ip, strict=False)
    except ValueError:
        raise HTTPException(400, f"Invalid IP address or CIDR: {ip}")

    ips = _load_manual_db()
    if ip in ips:
        raise HTTPException(409, f"{ip} is already manually banned")

    ok, _, err = f2b("set", MANUAL_JAIL, "banip", ip)
    if not ok:
        raise HTTPException(503, f"Failed to ban {ip}: {err}")

    ips.append(ip)
    _save_manual_db(ips)
    return {"success": True, "ip": ip}


@app.delete("/api/f2b/manual/ban")
def manual_unban(ip: str):
    ips = _load_manual_db()
    if ip not in ips:
        raise HTTPException(404, f"{ip} is not manually banned")

    f2b("set", MANUAL_JAIL, "unbanip", ip)
    _save_manual_db([x for x in ips if x != ip])
    return {"success": True, "ip": ip}


@app.get("/health")
async def health():
    return {"status": "ok"}
