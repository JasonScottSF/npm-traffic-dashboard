import csv
import io
import os
import asyncio
import asyncpg
import aiohttp
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Optional
from datetime import datetime, timedelta, timezone

app = FastAPI(title="NPM Traffic Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL     = os.environ["DATABASE_URL"]
RETENTION_DAYS   = int(os.environ.get("RETENTION_DAYS", "90"))
ABUSEIPDB_KEY    = os.environ.get("ABUSEIPDB_KEY", "")

_pool: asyncpg.Pool = None

# In-memory cache for AbuseIPDB lookups: ip -> {data, fetched_at (epoch)}
_rep_cache: dict = {}
_REP_CACHE_TTL = 3600  # 1 hour

# In-memory cache for ipinfo.io lookups: ip -> {data, fetched_at (epoch)}
_ipinfo_cache: dict = {}
_IPINFO_CACHE_TTL = 3600  # 1 hour


async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _pool


# ── Schema migration: ensure new tables exist ─────────────────────────────────

async def _ensure_schema(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS known_hosts (
                host       VARCHAR(255) PRIMARY KEY,
                first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                dismissed  BOOLEAN NOT NULL DEFAULT FALSE
            )
        """)


# ── Background: log retention ────────────────────────────────────────────────

async def _retention_loop():
    """Delete traffic records older than RETENTION_DAYS once per hour."""
    await asyncio.sleep(60)          # brief startup delay
    while True:
        try:
            pool  = await get_pool()
            cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
            async with pool.acquire() as conn:
                r = await conn.execute("DELETE FROM requests WHERE ts < $1", cutoff)
                s = await conn.execute("DELETE FROM sessions WHERE ended_at < $1", cutoff)
            print(f"[retention] deleted rows older than {RETENTION_DAYS}d — {r}, {s}")
        except Exception as e:
            print(f"[retention] error: {e}")
        await asyncio.sleep(3600)    # run every hour


# ── Background: new host detection ───────────────────────────────────────────

async def _host_alert_loop():
    """Check for hosts not yet recorded in known_hosts and register them."""
    await asyncio.sleep(30)
    while True:
        try:
            pool = await get_pool()
            async with pool.acquire() as conn:
                # All distinct hosts seen in the last 7 days
                rows = await conn.fetch(
                    "SELECT DISTINCT host FROM requests WHERE ts >= NOW() - INTERVAL '7 days' AND host IS NOT NULL"
                )
                for row in rows:
                    host = row["host"]
                    await conn.execute(
                        "INSERT INTO known_hosts (host) VALUES ($1) ON CONFLICT (host) DO NOTHING",
                        host,
                    )
        except Exception as e:
            print(f"[host-alert] error: {e}")
        await asyncio.sleep(300)     # check every 5 minutes


@app.on_event("startup")
async def startup():
    pool = await get_pool()
    await _ensure_schema(pool)
    await _ensure_uptime_table(pool)
    asyncio.create_task(_retention_loop())
    asyncio.create_task(_host_alert_loop())
    asyncio.create_task(_uptime_loop())


@app.on_event("shutdown")
async def shutdown():
    if _pool:
        await _pool.close()


def period_to_since(period: str) -> datetime:
    now = datetime.now(timezone.utc)
    mapping = {
        "24h": timedelta(hours=24),
        "3d": timedelta(days=3),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
        "90d": timedelta(days=90),
        "180d": timedelta(days=180),
        "360d": timedelta(days=360),
    }
    return now - mapping.get(period, timedelta(hours=24))


# ── Traffic endpoints ─────────────────────────────────────────────────────────

@app.get("/api/summary")
async def summary(period: str = "24h", host: Optional[str] = None):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT
                COUNT(*) AS total_requests,
                COUNT(DISTINCT client_ip) AS unique_visitors,
                COALESCE(SUM(bytes_sent), 0) AS total_bytes,
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count,
                SUM(CASE WHEN is_bot THEN 1 ELSE 0 END) AS bot_count,
                COUNT(DISTINCT host) AS host_count,
                ROUND(AVG(bytes_sent)) AS avg_bytes
            FROM requests
            WHERE ts >= $1 {host_filter}
            """,
            *params,
        )
    return dict(row)


@app.get("/api/timeseries")
async def timeseries(period: str = "24h", host: Optional[str] = None):
    pool = await get_pool()
    since = period_to_since(period)

    delta = datetime.now(timezone.utc) - since
    bucket = "hour" if delta.days <= 7 else "day"

    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                date_trunc(${len(params)+1}, ts) AS bucket,
                COUNT(*) AS requests,
                COUNT(DISTINCT client_ip) AS unique_visitors,
                COALESCE(SUM(bytes_sent), 0) AS bytes,
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN is_bot THEN 1 ELSE 0 END) AS bots
            FROM requests
            WHERE ts >= $1 {host_filter}
            GROUP BY 1
            ORDER BY 1
            """,
            *params,
            bucket,
        )
    return [
        {
            "time": r["bucket"].isoformat(),
            "requests": r["requests"],
            "unique_visitors": r["unique_visitors"],
            "bytes": r["bytes"],
            "errors": r["errors"],
            "bots": r["bots"],
        }
        for r in rows
    ]


@app.get("/api/top_hosts")
async def top_hosts(period: str = "24h", limit: int = 20):
    pool = await get_pool()
    since = period_to_since(period)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                host,
                COUNT(*) AS requests,
                COUNT(DISTINCT client_ip) AS unique_visitors,
                COALESCE(SUM(bytes_sent), 0) AS bytes,
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
            FROM requests
            WHERE ts >= $1
            GROUP BY host
            ORDER BY requests DESC
            LIMIT $2
            """,
            since, limit,
        )
    return [dict(r) for r in rows]


@app.get("/api/top_paths")
async def top_paths(period: str = "24h", host: Optional[str] = None, limit: int = 20):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT path, COUNT(*) AS requests, COALESCE(SUM(bytes_sent), 0) AS bytes
            FROM requests
            WHERE ts >= $1 {host_filter}
            GROUP BY path
            ORDER BY requests DESC
            LIMIT ${len(params)+1}
            """,
            *params, limit,
        )
    return [dict(r) for r in rows]


@app.get("/api/status_codes")
async def status_codes(period: str = "24h", host: Optional[str] = None):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT status_code, COUNT(*) AS count
            FROM requests
            WHERE ts >= $1 {host_filter}
            GROUP BY status_code
            ORDER BY count DESC
            """,
            *params,
        )
    return [{"status": r["status_code"], "count": r["count"]} for r in rows]


@app.get("/api/top_countries")
async def top_countries(period: str = "24h", host: Optional[str] = None, limit: int = 15):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                COALESCE(country_code, 'XX') AS country_code,
                COUNT(*) AS requests,
                COUNT(DISTINCT client_ip) AS unique_visitors
            FROM requests
            WHERE ts >= $1 {host_filter}
            GROUP BY 1
            ORDER BY requests DESC
            LIMIT ${len(params)+1}
            """,
            *params, limit,
        )
    return [dict(r) for r in rows]


@app.get("/api/top_referers")
async def top_referers(period: str = "24h", host: Optional[str] = None, limit: int = 20):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                COALESCE(NULLIF(referer, ''), '(direct)') AS referer,
                COUNT(*) AS requests
            FROM requests
            WHERE ts >= $1 AND referer IS NOT NULL AND referer != '-' {host_filter}
            GROUP BY 1
            ORDER BY requests DESC
            LIMIT ${len(params)+1}
            """,
            *params, limit,
        )
    return [dict(r) for r in rows]


@app.get("/api/browsers")
async def browsers(period: str = "24h", host: Optional[str] = None):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                COALESCE(browser, 'Unknown') AS browser,
                device_type,
                COUNT(*) AS requests
            FROM requests
            WHERE ts >= $1 {host_filter}
            GROUP BY 1, 2
            ORDER BY requests DESC
            LIMIT 20
            """,
            *params,
        )
    return [dict(r) for r in rows]


@app.get("/api/heatmap")
async def heatmap(period: str = "30d", host: Optional[str] = None):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                EXTRACT(DOW FROM ts AT TIME ZONE 'UTC')::int AS day_of_week,
                EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC')::int AS hour_of_day,
                COUNT(*) AS requests
            FROM requests
            WHERE ts >= $1 {host_filter}
            GROUP BY 1, 2
            ORDER BY 1, 2
            """,
            *params,
        )
    return [{"day": r["day_of_week"], "hour": r["hour_of_day"], "requests": r["requests"]} for r in rows]


@app.get("/api/top_ips")
async def top_ips(period: str = "24h", host: Optional[str] = None, limit: int = 20):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                client_ip::text AS ip,
                COUNT(*) AS requests,
                COALESCE(SUM(bytes_sent), 0) AS bytes,
                is_bot,
                country_code
            FROM requests
            WHERE ts >= $1 {host_filter}
            GROUP BY client_ip, is_bot, country_code
            ORDER BY requests DESC
            LIMIT ${len(params)+1}
            """,
            *params, limit,
        )
    return [dict(r) for r in rows]


@app.get("/api/live")
async def live():
    pool = await get_pool()
    since = datetime.now(timezone.utc) - timedelta(seconds=60)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                COUNT(*) AS requests_last_60s,
                COUNT(DISTINCT client_ip) AS unique_ips,
                COALESCE(SUM(bytes_sent), 0) AS bytes_last_60s,
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors_last_60s
            FROM requests
            WHERE ts >= $1
            """,
            since,
        )
        recent = await conn.fetch(
            """
            SELECT ts, host, client_ip::text AS ip, method, path, status_code, bytes_sent, country_code
            FROM requests
            WHERE ts >= $1
            ORDER BY ts DESC
            LIMIT 50
            """,
            since,
        )
    return {
        "summary": dict(row),
        "recent": [
            {
                "ts": r["ts"].isoformat(),
                "host": r["host"],
                "ip": r["ip"],
                "method": r["method"],
                "path": r["path"],
                "status": r["status_code"],
                "bytes": r["bytes_sent"],
                "country": r["country_code"],
            }
            for r in recent
        ],
    }


@app.get("/api/hosts")
async def hosts():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT DISTINCT host FROM requests ORDER BY host")
    return [r["host"] for r in rows]


@app.get("/api/errors")
async def errors(period: str = "24h", host: Optional[str] = None, limit: int = 200):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                ts, host, client_ip::text AS ip, method, path,
                status_code, bytes_sent, referer, country_code
            FROM requests
            WHERE ts >= $1 AND status_code >= 400 {host_filter}
            ORDER BY ts DESC
            LIMIT ${len(params)+1}
            """,
            *params, limit,
        )
    return [
        {
            "ts": r["ts"].isoformat(),
            "host": r["host"],
            "ip": r["ip"],
            "method": r["method"],
            "path": r["path"],
            "status": r["status_code"],
            "bytes": r["bytes_sent"],
            "referer": r["referer"],
            "country": r["country_code"],
        }
        for r in rows
    ]


@app.get("/api/bots")
async def bots(period: str = "24h", host: Optional[str] = None, limit: int = 100):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                client_ip::text AS ip,
                country_code,
                COUNT(*) AS requests,
                COALESCE(SUM(bytes_sent), 0) AS bytes,
                MAX(ts) AS last_seen,
                array_agg(DISTINCT user_agent) FILTER (WHERE user_agent IS NOT NULL) AS user_agents
            FROM requests
            WHERE ts >= $1 AND is_bot = true {host_filter}
            GROUP BY client_ip, country_code
            ORDER BY requests DESC
            LIMIT ${len(params)+1}
            """,
            *params, limit,
        )
    return [
        {
            "ip": r["ip"],
            "country": r["country_code"],
            "requests": r["requests"],
            "bytes": r["bytes"],
            "last_seen": r["last_seen"].isoformat(),
            "user_agents": (r["user_agents"] or [])[:3],
        }
        for r in rows
    ]


@app.get("/api/unique_visitors")
async def unique_visitors(period: str = "24h", host: Optional[str] = None, limit: int = 100):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                client_ip::text AS ip,
                country_code,
                browser,
                device_type,
                is_bot,
                COUNT(*) AS requests,
                COALESCE(SUM(bytes_sent), 0) AS bytes,
                MIN(ts) AS first_seen,
                MAX(ts) AS last_seen
            FROM requests
            WHERE ts >= $1 AND is_bot = false {host_filter}
            GROUP BY client_ip, country_code, browser, device_type, is_bot
            ORDER BY requests DESC
            LIMIT ${len(params)+1}
            """,
            *params, limit,
        )
    return [
        {
            "ip": r["ip"],
            "country": r["country_code"],
            "browser": r["browser"],
            "device": r["device_type"],
            "requests": r["requests"],
            "bytes": r["bytes"],
            "first_seen": r["first_seen"].isoformat(),
            "last_seen": r["last_seen"].isoformat(),
        }
        for r in rows
    ]


@app.get("/api/bandwidth_detail")
async def bandwidth_detail(period: str = "24h"):
    pool = await get_pool()
    since = period_to_since(period)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                host,
                COALESCE(SUM(bytes_sent), 0) AS bytes,
                COUNT(*) AS requests,
                ROUND(AVG(bytes_sent)) AS avg_bytes
            FROM requests
            WHERE ts >= $1
            GROUP BY host
            ORDER BY bytes DESC
            LIMIT 30
            """,
            since,
        )
    return [dict(r) for r in rows]


# ── New host alerts ───────────────────────────────────────────────────────────

@app.get("/api/new_hosts")
async def new_hosts():
    """Return hosts seen for the first time in the last 7 days that haven't been dismissed."""
    pool = await get_pool()
    since = datetime.now(timezone.utc) - timedelta(days=7)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT host, first_seen
            FROM known_hosts
            WHERE first_seen >= $1 AND dismissed = FALSE
            ORDER BY first_seen DESC
            """,
            since,
        )
    return [{"host": r["host"], "first_seen": r["first_seen"].isoformat()} for r in rows]


@app.post("/api/new_hosts/{host}/dismiss")
async def dismiss_host(host: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE known_hosts SET dismissed = TRUE WHERE host = $1", host
        )
    return {"ok": True}


# ── IP reputation (AbuseIPDB) ─────────────────────────────────────────────────

@app.get("/api/ip_rep/{ip}")
async def ip_reputation(ip: str):
    if not ABUSEIPDB_KEY:
        return {"error": "ABUSEIPDB_KEY not configured"}

    now = datetime.now(timezone.utc).timestamp()
    cached = _rep_cache.get(ip)
    if cached and (now - cached["fetched_at"]) < _REP_CACHE_TTL:
        return cached["data"]

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://api.abuseipdb.com/api/v2/check",
                params={"ipAddress": ip, "maxAgeInDays": 90},
                headers={"Key": ABUSEIPDB_KEY, "Accept": "application/json"},
                timeout=aiohttp.ClientTimeout(total=8),
            ) as resp:
                payload = await resp.json()
    except Exception as e:
        return {"error": str(e)}

    data = payload.get("data", payload)
    _rep_cache[ip] = {"data": data, "fetched_at": now}
    return data


# ── IP info (ipinfo.io, no key needed) ───────────────────────────────────────

@app.get("/api/ip_info/{ip}")
async def ip_info(ip: str):
    """Return org/ISP, city, country for an IP via ipinfo.io (free tier, no key)."""
    now = datetime.now(timezone.utc).timestamp()
    cached = _ipinfo_cache.get(ip)
    if cached and (now - cached["fetched_at"]) < _IPINFO_CACHE_TTL:
        return cached["data"]

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"https://ipinfo.io/{ip}/json",
                headers={"Accept": "application/json"},
                timeout=aiohttp.ClientTimeout(total=6),
            ) as resp:
                payload = await resp.json(content_type=None)
    except Exception as e:
        return {"error": str(e)}

    data = {
        "ip":      payload.get("ip", ip),
        "org":     payload.get("org", ""),       # e.g. "AS15169 Google LLC"
        "city":    payload.get("city", ""),
        "region":  payload.get("region", ""),
        "country": payload.get("country", ""),
        "hostname": payload.get("hostname", ""),
    }
    _ipinfo_cache[ip] = {"data": data, "fetched_at": now}
    return data


# ── Traffic CSV export ────────────────────────────────────────────────────────

@app.get("/api/export/traffic.csv")
async def export_traffic(period: str = "24h", host: Optional[str] = None):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT ts, host, client_ip::text AS ip, method, path, status_code,
                       bytes_sent, referer, country_code, is_bot, browser, device_type
                FROM requests WHERE ts >= $1 {host_filter}
                ORDER BY ts DESC LIMIT 100000""",
            *params,
        )

    def generate():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(['timestamp', 'host', 'ip', 'method', 'path', 'status',
                    'bytes', 'referer', 'country', 'is_bot', 'browser', 'device'])
        yield buf.getvalue()
        for row in rows:
            buf.seek(0); buf.truncate(0)
            w.writerow([row['ts'].isoformat(), row['host'] or '', row['ip'],
                        row['method'] or '', row['path'] or '', row['status_code'],
                        row['bytes_sent'], row['referer'] or '', row['country_code'] or '',
                        row['is_bot'], row['browser'] or '', row['device_type'] or ''])
            yield buf.getvalue()

    filename = f"traffic-{period}{('-' + host) if host else ''}.csv"
    return StreamingResponse(generate(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ── Uptime tracking ───────────────────────────────────────────────────────────

async def _ensure_uptime_table(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS host_uptime (
                id          BIGSERIAL PRIMARY KEY,
                host        VARCHAR(255) NOT NULL,
                ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                status_code SMALLINT,
                response_ms FLOAT,
                error       TEXT
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_uptime_host_ts ON host_uptime (host, ts DESC)"
        )


async def _uptime_loop():
    """HEAD-probe each known host every 5 minutes and record the result."""
    await asyncio.sleep(90)          # give containers time to come up
    while True:
        try:
            pool = await get_pool()
            async with pool.acquire() as conn:
                hosts = await conn.fetch(
                    "SELECT host FROM known_hosts WHERE dismissed = FALSE ORDER BY host LIMIT 50"
                )
            timeout = aiohttp.ClientTimeout(total=10)
            for row in hosts:
                host = row["host"]
                url  = f"https://{host}/" if not host.startswith("http") else host
                start = asyncio.get_event_loop().time()
                try:
                    async with aiohttp.ClientSession() as session:
                        async with session.head(url, timeout=timeout,
                                                allow_redirects=True, ssl=False) as resp:
                            ms = (asyncio.get_event_loop().time() - start) * 1000
                            async with pool.acquire() as conn:
                                await conn.execute(
                                    "INSERT INTO host_uptime (host, status_code, response_ms) VALUES ($1,$2,$3)",
                                    host, resp.status, round(ms, 1),
                                )
                except Exception as e:
                    async with pool.acquire() as conn:
                        await conn.execute(
                            "INSERT INTO host_uptime (host, error) VALUES ($1,$2)",
                            host, str(e)[:200],
                        )
        except Exception as e:
            print(f"[uptime] error: {e}")
        await asyncio.sleep(300)     # every 5 minutes


@app.get("/api/uptime/summary")
async def uptime_summary():
    """Latest probe result per host + 24-hour availability percentage."""
    pool = await get_pool()
    since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    async with pool.acquire() as conn:
        latest = await conn.fetch("""
            SELECT DISTINCT ON (host) host, ts, status_code, response_ms, error
            FROM host_uptime
            ORDER BY host, ts DESC
        """)
        stats = await conn.fetch("""
            SELECT host,
                   COUNT(*) AS total,
                   SUM(CASE WHEN error IS NULL AND status_code < 500 THEN 1 ELSE 0 END) AS ok,
                   ROUND(AVG(response_ms) FILTER (WHERE response_ms IS NOT NULL))::int AS avg_ms
            FROM host_uptime
            WHERE ts >= $1
            GROUP BY host
        """, since_24h)

    stats_map = {r["host"]: r for r in stats}
    result = []
    for r in latest:
        s = stats_map.get(r["host"])
        avail = round(s["ok"] / s["total"] * 100, 1) if s and s["total"] > 0 else None
        result.append({
            "host":            r["host"],
            "ts":              r["ts"].isoformat(),
            "status_code":     r["status_code"],
            "response_ms":     r["response_ms"],
            "error":           r["error"],
            "availability_24h": avail,
            "avg_ms_24h":      s["avg_ms"] if s else None,
        })
    return sorted(result, key=lambda x: x["host"])


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}
