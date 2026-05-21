import csv
import io
import os
import re
import ssl
import socket
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


DATABASE_URL     = os.environ["DATABASE_URL"]
RETENTION_DAYS   = int(os.environ.get("RETENTION_DAYS", "90"))
ABUSEIPDB_KEY    = _read_secret("abuseipdb_key", fallback="")

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
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            password=_read_secret("db_password"),
            min_size=2,
            max_size=20,
            command_timeout=30,
            max_inactive_connection_lifetime=300,
        )
    return _pool


# ── Schema migration: ensure new tables exist ─────────────────────────────────

async def _ensure_schema(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS known_hosts (
                host            VARCHAR(255) PRIMARY KEY,
                first_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                dismissed       BOOLEAN NOT NULL DEFAULT FALSE,
                uptime_enabled  BOOLEAN NOT NULL DEFAULT TRUE
            )
        """)
        await conn.execute(
            "ALTER TABLE known_hosts ADD COLUMN IF NOT EXISTS uptime_enabled BOOLEAN NOT NULL DEFAULT TRUE"
        )
        # Add response_time_ms if not present (schema.sql already has it for new installs)
        await conn.execute("""
            ALTER TABLE requests ADD COLUMN IF NOT EXISTS response_time_ms FLOAT
        """)
        # Drop legacy uptime table (feature removed)
        await conn.execute("DROP TABLE IF EXISTS host_uptime")


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
    _ipinfo_cache.clear()   # ensure stale data from previous provider doesn't linger
    pool = await get_pool()
    await _ensure_schema(pool)
    asyncio.create_task(_retention_loop())
    asyncio.create_task(_host_alert_loop())


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

@app.get("/api/search")
async def search(
    q:      str = Query("", min_length=0),
    period: str = "24h",
    limit:  int = Query(200, le=500),
):
    """Full-text search across path, client_ip, host, user_agent."""
    if len(q) < 3:
        return []
    pool = await get_pool()
    since = period_to_since(period)
    pattern = f"%{q}%"
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, host, host(client_ip) AS client_ip, method, path,
                   status_code, bytes_sent, response_time_ms, country_code
            FROM requests
            WHERE ts >= $1
              AND (
                  path ILIKE $2
                  OR host(client_ip)::text ILIKE $2
                  OR host ILIKE $2
                  OR user_agent ILIKE $2
              )
            ORDER BY ts DESC
            LIMIT $3
            """,
            since, pattern, limit,
        )
    return [
        {
            "ts":               r["ts"].isoformat(),
            "host":             r["host"],
            "client_ip":        r["client_ip"],
            "method":           r["method"],
            "path":             r["path"],
            "status_code":      r["status_code"],
            "bytes_sent":       r["bytes_sent"],
            "response_time_ms": r["response_time_ms"],
            "country_code":     r["country_code"],
        }
        for r in rows
    ]


@app.get("/api/summary")
async def summary(period: str = "24h", host: Optional[str] = None):
    pool = await get_pool()
    since = period_to_since(period)
    now   = datetime.now(timezone.utc)
    prev_since = since - (now - since)   # previous window of equal length

    host_filter      = "AND host = $2" if host else ""
    params           = [since, host] if host else [since]
    prev_host_filter = "AND host = $3" if host else ""
    prev_params      = [prev_since, since, host] if host else [prev_since, since]

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
        prev = await conn.fetchrow(
            f"""
            SELECT
                COUNT(*) AS total_requests,
                COALESCE(SUM(bytes_sent), 0) AS total_bytes,
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count,
                SUM(CASE WHEN is_bot THEN 1 ELSE 0 END) AS bot_count
            FROM requests
            WHERE ts >= $1 AND ts < $2 {prev_host_filter}
            """,
            *prev_params,
        )

    def _delta(curr, prev_val):
        if not prev_val:
            return None
        return round((curr - prev_val) / prev_val * 100, 1)

    # Count 429s in the period
    rl_filter = "AND host = $2" if host else ""
    rl_params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rl_row = await conn.fetchrow(
            f"SELECT COUNT(*) AS cnt FROM requests WHERE ts >= $1 AND status_code = 429 {rl_filter}",
            *rl_params,
        )

    result = dict(row)
    result["delta_requests"]   = _delta(row["total_requests"], prev["total_requests"])
    result["delta_bytes"]      = _delta(row["total_bytes"],    prev["total_bytes"])
    result["delta_errors"]     = _delta(row["error_count"],    prev["error_count"])
    result["delta_bots"]       = _delta(row["bot_count"],      prev["bot_count"])
    result["rate_limited_count"] = rl_row["cnt"] if rl_row else 0
    return result


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


@app.get("/api/top_paths_by_host")
async def top_paths_by_host(period: str = "24h", limit: int = 30):
    """Return top paths with their host, so hammered paths show which site is affected."""
    pool = await get_pool()
    since = period_to_since(period)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT host, path, COUNT(*) AS requests, COALESCE(SUM(bytes_sent), 0) AS bytes
            FROM requests
            WHERE ts >= $1
            GROUP BY host, path
            ORDER BY requests DESC
            LIMIT $2
            """,
            since, limit,
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
                host(client_ip)                                       AS ip,
                COUNT(*)                                              AS requests,
                COALESCE(SUM(bytes_sent), 0)                         AS bytes,
                bool_or(is_bot)                                       AS is_bot,
                (array_agg(country_code ORDER BY country_code))[1]   AS country_code
            FROM requests
            WHERE ts >= $1 {host_filter}
            GROUP BY client_ip
            ORDER BY requests DESC
            LIMIT ${len(params)+1}
            """,
            *params, limit,
        )
    result = [dict(r) for r in rows]

    # Enrich with ISP/org — deduplicate IPs first so zip never misaligns
    unique_ips = list(dict.fromkeys(r["ip"] for r in result if r.get("ip")))
    infos = await asyncio.gather(*[_fetch_ip_info(ip) for ip in unique_ips], return_exceptions=True)
    info_map = {
        ip: (info.get("isp") or info.get("org") or "")
        for ip, info in zip(unique_ips, infos)
        if isinstance(info, dict)
    }

    for r in result:
        r["org"] = info_map.get(r["ip"], "")

    return result



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
            SELECT ts, host, host(client_ip) AS ip, method, path, status_code, bytes_sent, country_code
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
    since = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT host FROM requests WHERE ts >= $1 ORDER BY host",
            since,
        )
    return [r["host"] for r in rows]


@app.get("/api/ip_errors")
async def ip_errors(ip: str, period: str = "24h", limit: int = 100):
    """Return error requests (4xx/5xx) from a specific IP address."""
    pool = await get_pool()
    since = period_to_since(period)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, host, method, path, status_code, bytes_sent, referer, user_agent
            FROM requests
            WHERE ts >= $1
              AND host(client_ip) = $2
              AND status_code >= 400
            ORDER BY ts DESC
            LIMIT $3
            """,
            since, ip, limit,
        )
    return [
        {
            "ts":      r["ts"].isoformat(),
            "host":    r["host"],
            "method":  r["method"],
            "path":    r["path"],
            "status":  r["status_code"],
            "bytes":   r["bytes_sent"],
            "referer": r["referer"],
            "ua":      r["user_agent"],
        }
        for r in rows
    ]


@app.get("/api/country_detail")
async def country_detail(country: str, period: str = "24h", limit: int = 50):
    """Return the most recent IPs from a specific country code."""
    pool = await get_pool()
    since = period_to_since(period)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT host(client_ip) AS ip,
                   COUNT(*)                          AS requests,
                   MAX(ts)                           AS last_seen,
                   COUNT(DISTINCT path)              AS paths,
                   SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
            FROM requests
            WHERE ts >= $1
              AND (country_code = $2 OR ($2 = 'XX' AND (country_code IS NULL OR country_code = 'XX')))
            GROUP BY client_ip
            ORDER BY last_seen DESC
            LIMIT $3
            """,
            since, country, limit,
        )
    return [
        {
            "ip":        r["ip"],
            "requests":  r["requests"],
            "last_seen": r["last_seen"].isoformat(),
            "paths":     r["paths"],
            "errors":    r["errors"],
        }
        for r in rows
    ]


@app.get("/api/ip_activity/{ip}")
async def ip_activity(ip: str, period: str = "24h", limit: int = 30):
    """Return recent requests from a specific IP (all status codes)."""
    pool = await get_pool()
    since = period_to_since(period)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, host, method, path, status_code, bytes_sent
            FROM requests
            WHERE ts >= $1 AND host(client_ip) = $2
            ORDER BY ts DESC
            LIMIT $3
            """,
            since, ip, limit,
        )
    return [
        {
            "ts":     r["ts"].isoformat(),
            "host":   r["host"],
            "method": r["method"],
            "path":   r["path"],
            "status": r["status_code"],
            "bytes":  r["bytes_sent"],
        }
        for r in rows
    ]


@app.get("/api/referer_detail")
async def referer_detail(referer: str, period: str = "24h", limit: int = 200):
    """Return all requests that arrived with a specific Referer header."""
    pool = await get_pool()
    since = period_to_since(period)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, host, host(client_ip) AS ip, method, path,
                   status_code, bytes_sent, country_code, user_agent
            FROM requests
            WHERE ts >= $1 AND referer = $2
            ORDER BY ts DESC
            LIMIT $3
            """,
            since, referer, limit,
        )
    return [
        {
            "ts":      r["ts"].isoformat(),
            "host":    r["host"],
            "ip":      r["ip"],
            "method":  r["method"],
            "path":    r["path"],
            "status":  r["status_code"],
            "bytes":   r["bytes_sent"],
            "country": r["country_code"],
            "ua":      r["user_agent"],
        }
        for r in rows
    ]


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
                ts, host, host(client_ip) AS ip, method, path,
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


@app.get("/api/rate_limited")
async def rate_limited(period: str = "24h", limit: int = Query(50, le=200)):
    """Top IPs hitting 429 rate-limit responses."""
    pool = await get_pool()
    since = period_to_since(period)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT host(client_ip) AS client_ip,
                   COUNT(*) AS hits,
                   MAX(ts) AS last_seen
            FROM requests
            WHERE status_code = 429 AND ts >= $1
            GROUP BY client_ip
            ORDER BY hits DESC
            LIMIT $2
            """,
            since, limit,
        )
    return [
        {
            "client_ip": r["client_ip"],
            "hits":      r["hits"],
            "last_seen": r["last_seen"].isoformat(),
        }
        for r in rows
    ]


@app.get("/api/host_traffic_now")
async def host_traffic_now():
    """Request rate per host in the last 5 minutes."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT host,
                   COUNT(*) AS rpm,
                   COALESCE(SUM(bytes_sent), 0) AS bytes,
                   COUNT(CASE WHEN status_code >= 400 THEN 1 END) AS errors
            FROM requests
            WHERE ts >= NOW() - INTERVAL '5 minutes'
            GROUP BY host
            ORDER BY rpm DESC
            """
        )
    return [
        {
            "host":   r["host"],
            "rpm":    r["rpm"],
            "bytes":  r["bytes"],
            "errors": r["errors"],
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
                host(client_ip) AS ip,
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
                host(client_ip) AS ip,
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

async def _fetch_ip_info(ip: str) -> dict:
    """Fetch ISP/org from ipwho.is (HTTPS, free, no key required).
    Returns connection.isp which is the specific ISP name, not just the ASN registrant.
    Results cached 1 hour."""
    now = datetime.now(timezone.utc).timestamp()
    cached = _ipinfo_cache.get(ip)
    if cached and (now - cached["fetched_at"]) < _IPINFO_CACHE_TTL:
        return cached["data"]
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"https://ipwho.is/{ip}",
                headers={"Accept": "application/json"},
                timeout=aiohttp.ClientTimeout(total=6),
            ) as resp:
                payload = await resp.json(content_type=None)
    except Exception:
        return {}
    if not payload.get("success"):
        return {}
    conn = payload.get("connection", {})
    data = {
        "ip":      ip,
        "isp":     conn.get("isp", ""),
        "org":     conn.get("org", "") or conn.get("isp", ""),
        "city":    payload.get("city", ""),
        "country": payload.get("country", ""),
    }
    _ipinfo_cache[ip] = {"data": data, "fetched_at": now}
    return data


@app.get("/api/ip_info/{ip}")
async def ip_info(ip: str):
    """Single-IP lookup — still available for individual use."""
    return await _fetch_ip_info(ip)


# ── Traffic CSV export ────────────────────────────────────────────────────────

@app.get("/api/export/traffic.csv")
async def export_traffic(period: str = "24h", host: Optional[str] = None):
    pool = await get_pool()
    since = period_to_since(period)
    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT ts, host, host(client_ip) AS ip, method, path, status_code,
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


# ── Backup status ─────────────────────────────────────────────────────────────

@app.post("/api/backup/trigger")
async def trigger_backup():
    """Signal the backup container to run an immediate backup."""
    import pathlib
    from fastapi import HTTPException
    try:
        trigger = pathlib.Path("/trigger/run_now")
        trigger.parent.mkdir(parents=True, exist_ok=True)
        trigger.touch()
        return {"queued": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/backup/status")
async def backup_status(limit: int = 20):
    """Return the most recent backup runs recorded by the backup container."""
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT ts, status, message, commit_sha, duration_s
                FROM backup_status
                ORDER BY ts DESC
                LIMIT $1
                """,
                limit,
            )
        return [
            {
                "ts":         r["ts"].isoformat(),
                "status":     r["status"],
                "message":    r["message"],
                "commit_sha": r["commit_sha"],
                "duration_s": r["duration_s"],
            }
            for r in rows
        ]
    except Exception:
        # Table may not exist yet if backup has never run
        return []




# ── World Map ─────────────────────────────────────────────────────────────────

@app.get("/api/map_data")
async def map_data(period: str = "24h"):
    """Return per-country traffic + threat status for the world map."""
    pool = await get_pool()
    since = period_to_since(period)

    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                COALESCE(country_code, 'XX') AS cc,
                COUNT(*) AS requests,
                SUM(bytes_sent) AS bytes,
                SUM(CASE WHEN is_bot THEN 1 ELSE 0 END) AS bots,
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
            FROM requests
            WHERE ts >= $1
            GROUP BY cc
            ORDER BY requests DESC
            LIMIT 100
        """, since)

    # Fetch geo-blocked countries from fail2ban service
    blocked_ccs = set()
    try:
        import aiohttp as _aiohttp
        async with _aiohttp.ClientSession() as s:
            async with s.get("http://fail2ban:8001/api/f2b/geo/blocked", timeout=_aiohttp.ClientTimeout(total=3)) as r:
                data = await r.json()
                blocked_ccs = {c["country_code"] for c in data.get("countries", [])}
    except Exception:
        pass

    result = []
    for r in rows:
        cc = r["cc"]
        req = r["requests"]
        bot_pct = (r["bots"] / req * 100) if req else 0
        err_pct = (r["errors"] / req * 100) if req else 0
        is_bad = cc in blocked_ccs or bot_pct > 50 or err_pct > 70
        is_mixed = not is_bad and (bot_pct > 20 or err_pct > 30)
        result.append({
            "cc":       cc,
            "requests": req,
            "bytes":    r["bytes"] or 0,
            "bots":     r["bots"] or 0,
            "errors":   r["errors"] or 0,
            "blocked":  cc in blocked_ccs,
            "status":   "bad" if is_bad else ("mixed" if is_mixed else "good"),
        })

    return result


# ── Database stats & maintenance ──────────────────────────────────────────────

@app.get("/api/db/stats")
async def db_stats():
    """Return Postgres database size and per-table row counts + sizes."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        db_size = await conn.fetchrow(
            "SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty, "
            "pg_database_size(current_database()) AS bytes"
        )
        tables = await conn.fetch("""
            SELECT
                relname AS table_name,
                n_live_tup AS row_count,
                pg_size_pretty(pg_total_relation_size(relid)) AS size_pretty,
                pg_total_relation_size(relid) AS size_bytes
            FROM pg_stat_user_tables
            ORDER BY pg_total_relation_size(relid) DESC
        """)
        oldest = await conn.fetchrow("SELECT MIN(ts) AS oldest FROM requests")
        newest = await conn.fetchrow("SELECT MAX(ts) AS newest FROM requests")

    return {
        "db_size_pretty": db_size["pretty"],
        "db_size_bytes":  db_size["bytes"],
        "oldest_record":  oldest["oldest"].isoformat() if oldest and oldest["oldest"] else None,
        "newest_record":  newest["newest"].isoformat() if newest and newest["newest"] else None,
        "tables": [
            {
                "name":        r["table_name"],
                "rows":        r["row_count"],
                "size_pretty": r["size_pretty"],
                "size_bytes":  r["size_bytes"],
            }
            for r in tables
        ],
    }


@app.post("/api/db/vacuum")
async def db_vacuum():
    """Run VACUUM ANALYZE on the requests table (largest table, most benefit)."""
    conn = await asyncpg.connect(DATABASE_URL, password=_read_secret("db_password"))
    try:
        await conn.execute("VACUUM ANALYZE requests")
    finally:
        await conn.close()
    return {"success": True}


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}
