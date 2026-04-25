"""
Tails nginx proxy manager access log files and inserts parsed records into PostgreSQL.
NPM log format: $host $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
"""
import asyncio
import os
import re
import time
import glob
import asyncpg
import geoip2.database
import geoip2.errors
from pathlib import Path
from ua_parser import user_agent_parser
from datetime import datetime, timezone

DATABASE_URL = os.environ["DATABASE_URL"]
LOG_DIR = os.environ.get("LOG_DIR", "/npm_logs")
GEOIP_DB = os.environ.get("GEOIP_DB", "/geoip/GeoLite2-Country.mmdb")
BATCH_SIZE = 200
FLUSH_INTERVAL = 2  # seconds

# Matches NPM's actual log format:
# [timestamp] - status upstream - method scheme [host](http://host) "path" [Client ip] [Length n] [Gzip x] [Sent-to x] "ua" "referer"
LOG_RE = re.compile(
    r'\[(?P<time>[^\]]+)\] - (?P<status>\d+) \d+ - (?P<method>\S+) \S+ '
    r'\[(?P<host>[^\]]+)\]\([^)]+\) "(?P<path>[^"]*)" '
    r'\[Client (?P<ip>[^\]]+)\] \[Length (?P<bytes>\d+)\] '
    r'\[Gzip [^\]]*\] \[Sent-to [^\]]*\] '
    r'"(?P<ua>[^"]*)" "(?P<referer>[^"]*)"'
)

BOT_PATTERNS = re.compile(
    r"bot|crawler|spider|slurp|mediapartners|adsbot|bingpreview|facebookexternalhit|"
    r"twitterbot|linkedinbot|whatsapp|pinterest|embedly|quora|rogerbot|ia_archiver|"
    r"semrush|ahrefs|mj12bot|dotbot|masscan|nikto|nmap|zgrab|nuclei",
    re.IGNORECASE,
)

geo_reader = None


def load_geo():
    global geo_reader
    if os.path.exists(GEOIP_DB):
        try:
            geo_reader = geoip2.database.Reader(GEOIP_DB)
            print(f"GeoIP database loaded from {GEOIP_DB}")
        except Exception as e:
            print(f"Warning: could not load GeoIP DB: {e}")


def get_country(ip: str) -> str | None:
    if not geo_reader:
        return None
    try:
        return geo_reader.country(ip).country.iso_code
    except (geoip2.errors.AddressNotFoundError, Exception):
        return None


def parse_browser(ua: str) -> tuple[str, str]:
    if not ua or ua == "-":
        return "Unknown", "unknown"
    parsed = user_agent_parser.Parse(ua)
    family = parsed["user_agent"]["family"] or "Unknown"
    device = parsed["device"]["family"] or "Other"
    if device.lower() in ("other", "generic"):
        device_type = "desktop"
    elif "mobile" in device.lower() or "phone" in device.lower():
        device_type = "mobile"
    elif "tablet" in device.lower() or "ipad" in device.lower():
        device_type = "tablet"
    else:
        device_type = "desktop"
    return family, device_type


def parse_line(line: str) -> dict | None:
    m = LOG_RE.match(line.strip())
    if not m:
        return None
    try:
        ts = datetime.strptime(m.group("time"), "%d/%b/%Y:%H:%M:%S %z")
    except ValueError:
        return None

    ua = m.group("ua")
    is_bot = bool(BOT_PATTERNS.search(ua))
    browser, device_type = ("Bot", "bot") if is_bot else parse_browser(ua)
    ip = m.group("ip")
    referer = m.group("referer")
    if referer == "-":
        referer = None

    return {
        "ts": ts,
        "host": m.group("host"),
        "client_ip": ip,
        "method": m.group("method")[:10],
        "path": m.group("path")[:2000],
        "status_code": int(m.group("status")),
        "bytes_sent": int(m.group("bytes")),
        "referer": referer,
        "user_agent": ua[:512],
        "country_code": get_country(ip),
        "is_bot": is_bot,
        "browser": browser[:64],
        "device_type": device_type,
    }


async def insert_batch(pool: asyncpg.Pool, batch: list[dict]):
    if not batch:
        return
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO requests
                (ts, host, client_ip, method, path, status_code, bytes_sent,
                 referer, user_agent, country_code, is_bot, browser, device_type)
            VALUES ($1,$2,$3::inet,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            """,
            [
                (
                    r["ts"], r["host"], r["client_ip"], r["method"], r["path"],
                    r["status_code"], r["bytes_sent"], r["referer"], r["user_agent"],
                    r["country_code"], r["is_bot"], r["browser"], r["device_type"],
                )
                for r in batch
            ],
        )


async def tail_file(path: str, pool: asyncpg.Pool, state: dict):
    """Tail a single log file, resuming from last position."""
    file_key = path
    batch = []
    last_flush = time.monotonic()

    try:
        f = open(path, "r", errors="replace")
        # Seek to end on first open (skip historical on startup unless fresh)
        if file_key not in state:
            f.seek(0)  # read from beginning on first run to load historical data
            state[file_key] = 0
        else:
            f.seek(state[file_key])

        while True:
            line = f.readline()
            if line:
                record = parse_line(line)
                if record:
                    batch.append(record)
                state[file_key] = f.tell()
            else:
                # Check if file was rotated
                try:
                    if os.stat(path).st_ino != os.fstat(f.fileno()).st_ino:
                        f.close()
                        f = open(path, "r", errors="replace")
                        state[file_key] = 0
                        continue
                except FileNotFoundError:
                    pass

                if batch and (time.monotonic() - last_flush >= FLUSH_INTERVAL or len(batch) >= BATCH_SIZE):
                    await insert_batch(pool, batch)
                    batch.clear()
                    last_flush = time.monotonic()
                await asyncio.sleep(0.5)
    except Exception as e:
        print(f"Error tailing {path}: {e}")
    finally:
        try:
            f.close()
        except Exception:
            pass


async def discover_and_tail(pool: asyncpg.Pool):
    """Discover NPM log files and tail them, watching for new files."""
    state = {}
    tasks = {}

    while True:
        pattern = os.path.join(LOG_DIR, "*_access.log")
        current_files = set(glob.glob(pattern))

        for path in current_files:
            if path not in tasks or tasks[path].done():
                print(f"Tailing: {path}")
                tasks[path] = asyncio.create_task(tail_file(path, pool, state))

        # Also tail the main access.log if present
        main_log = os.path.join(LOG_DIR, "access.log")
        if os.path.exists(main_log) and main_log not in tasks:
            tasks[main_log] = asyncio.create_task(tail_file(main_log, pool, state))

        await asyncio.sleep(30)


async def main():
    load_geo()
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    print(f"Connected to database. Watching {LOG_DIR} for NPM access logs...")
    await discover_and_tail(pool)


if __name__ == "__main__":
    asyncio.run(main())
