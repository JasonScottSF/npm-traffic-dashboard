import os
import asyncio
import asyncpg
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from datetime import datetime, timedelta, timezone

app = FastAPI(title="NPM Traffic Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.environ["DATABASE_URL"]
_pool: asyncpg.Pool = None


async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _pool


@app.on_event("startup")
async def startup():
    await get_pool()


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
    if delta.days <= 1:
        bucket = "hour"
    elif delta.days <= 7:
        bucket = "hour"
    else:
        bucket = "day"

    host_filter = "AND host = $2" if host else ""
    params = [since, host] if host else [since]

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                date_trunc(${{len(params)+1}}, ts) AS bucket,
                COUNT(*) AS requests,
                COUNT(DISTINCT client_ip) AS unique_visitors,
                COALESCE(SUM(bytes_sent), 0) AS bytes,
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN is_bot THEN 1 ELSE 0 END) AS bots
            FROM requests
            WHERE ts >= $1 {host_filter}
            GROUP BY 1
            ORDER BY 1
            """.replace("${len(params)+1}", f"${len(params)+1}"),
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
    """Last 60 seconds of traffic for live ticker."""
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
