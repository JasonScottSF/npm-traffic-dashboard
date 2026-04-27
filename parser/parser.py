"""
Tails nginx proxy manager access log files and inserts parsed records into PostgreSQL.
NPM log format: $host $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"

File positions are persisted to STATE_FILE so restarts (including reboots)
resume from where they left off rather than re-reading historical data.

State format (v2): {path: {"pos": int, "last_seen": ISO-8601}}
Old format (v1):   {path: int}  — migrated transparently on first load.
"""
import asyncio
import json
import os
import re
import time
import glob
import asyncpg
import geoip2.database
import geoip2.errors
from ua_parser import user_agent_parser
from datetime import datetime, timedelta, timezone

DATABASE_URL         = os.environ["DATABASE_URL"]
LOG_DIR              = os.environ.get("LOG_DIR",              "/npm_logs")
GEOIP_DB             = os.environ.get("GEOIP_DB",             "/geoip/GeoLite2-Country.mmdb")
STATE_FILE           = os.environ.get("STATE_FILE",           "/parser_state/positions.json")
DLQ_FILE             = os.environ.get("DLQ_FILE",             "/parser_state/dlq.jsonl")
STATE_RETENTION_DAYS = int(os.environ.get("STATE_RETENTION_DAYS", "90"))

BATCH_SIZE       = 200
FLUSH_INTERVAL   = 2    # seconds between DB flushes
STATE_SAVE_EVERY = 10   # seconds between state-file saves
DB_RETRY_DELAY   = 5    # seconds between DB connection retries

# Matches NPM's actual log format:
# [timestamp] - status upstream_response_time - method scheme host "path" [Client ip] [Length n] [Gzip x] [Sent-to x] "ua" "referer"
# upstream_response_time is in seconds (float) or "-" when no upstream
LOG_RE = re.compile(
    r'\[(?P<time>[^\]]+)\] - (?P<status>\d+) (?P<response_time>[\d.]+|-) - (?P<method>\S+) \S+ '
    r'(?P<host>\S+) "(?P<path>[^"]*)" '
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


# ── GeoIP ─────────────────────────────────────────────────────────────────────

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


# ── UA parsing ────────────────────────────────────────────────────────────────

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


# ── Dead letter queue ─────────────────────────────────────────────────────────

def _dlq_append(line: str, path: str):
    """Append an unparseable log line to the dead letter queue file."""
    stripped = line.strip()
    if not stripped:
        return   # skip blank lines silently
    try:
        os.makedirs(os.path.dirname(DLQ_FILE), exist_ok=True)
        with open(DLQ_FILE, "a") as fh:
            json.dump({
                "ts":   datetime.now(timezone.utc).isoformat(),
                "file": path,
                "line": stripped[:500],
            }, fh)
            fh.write("\n")
    except Exception:
        pass


# ── Log parsing ───────────────────────────────────────────────────────────────

def parse_line(line: str, path: str = "") -> dict | None:
    m = LOG_RE.match(line.strip())
    if not m:
        _dlq_append(line, path)
        return None
    try:
        ts = datetime.strptime(m.group("time"), "%d/%b/%Y:%H:%M:%S %z")
    except ValueError:
        _dlq_append(line, path)
        return None

    ua = m.group("ua")
    is_bot = bool(BOT_PATTERNS.search(ua))
    browser, device_type = ("Bot", "bot") if is_bot else parse_browser(ua)
    ip = m.group("ip")
    referer = m.group("referer")
    if referer == "-":
        referer = None

    rt = m.group("response_time")
    response_time_ms = None
    if rt and rt != "-":
        try:
            val = float(rt) * 1000  # NPM logs seconds; convert to ms
            if 0 < val < 300_000:   # sanity cap: 5 minutes
                response_time_ms = round(val, 1)
        except ValueError:
            pass

    return {
        "ts":               ts,
        "host":             m.group("host"),
        "client_ip":        ip,
        "method":           m.group("method")[:10],
        "path":             m.group("path")[:2000],
        "status_code":      int(m.group("status")),
        "bytes_sent":       int(m.group("bytes")),
        "referer":          referer,
        "user_agent":       ua[:512],
        "country_code":     get_country(ip),
        "is_bot":           is_bot,
        "browser":          browser[:64],
        "device_type":      device_type,
        "response_time_ms": response_time_ms,
    }


# ── DB ────────────────────────────────────────────────────────────────────────

async def connect_with_retry(database_url: str) -> asyncpg.Pool:
    """Keep trying to connect until the DB is ready."""
    while True:
        try:
            pool = await asyncpg.create_pool(database_url, min_size=1, max_size=5)
            print("Connected to database.")
            return pool
        except Exception as e:
            print(f"DB not ready ({e}), retrying in {DB_RETRY_DELAY}s…")
            await asyncio.sleep(DB_RETRY_DELAY)


async def insert_batch(pool: asyncpg.Pool, batch: list[dict]):
    if not batch:
        return
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO requests
                (ts, host, client_ip, method, path, status_code, bytes_sent,
                 referer, user_agent, country_code, is_bot, browser, device_type,
                 response_time_ms)
            VALUES ($1,$2,$3::inet,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            ON CONFLICT DO NOTHING
            """,
            [
                (
                    r["ts"], r["host"], r["client_ip"], r["method"], r["path"],
                    r["status_code"], r["bytes_sent"], r["referer"], r["user_agent"],
                    r["country_code"], r["is_bot"], r["browser"], r["device_type"],
                    r["response_time_ms"],
                )
                for r in batch
            ],
        )


# ── State persistence (v2 format) ─────────────────────────────────────────────
# Each entry: {"pos": int, "last_seen": "ISO-8601"}
# Old v1 format (plain int values) is migrated transparently.

def _get_pos(state: dict, path: str) -> int | None:
    """Return the saved byte position for path, or None if not tracked."""
    entry = state.get(path)
    if entry is None:
        return None
    if isinstance(entry, int):          # v1 format
        return entry
    return entry.get("pos", 0)


def _set_pos(state: dict, path: str, pos: int):
    """Update the byte position for path, recording last_seen = now."""
    state[path] = {"pos": pos, "last_seen": datetime.now(timezone.utc).isoformat()}


def _prune_state(state: dict, current_files: set):
    """Remove stale entries for files that no longer exist and are older than STATE_RETENTION_DAYS."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=STATE_RETENTION_DAYS)
    to_remove = []
    for path, entry in state.items():
        if path in current_files:
            continue   # still active, keep it
        if isinstance(entry, int):
            # v1 entry with no timestamp — remove if file is gone
            if not os.path.exists(path):
                to_remove.append(path)
            continue
        last_seen_str = entry.get("last_seen")
        if not last_seen_str:
            continue
        try:
            last_seen = datetime.fromisoformat(last_seen_str)
            if last_seen.tzinfo is None:
                last_seen = last_seen.replace(tzinfo=timezone.utc)
            if last_seen < cutoff and not os.path.exists(path):
                to_remove.append(path)
        except Exception:
            pass
    for path in to_remove:
        del state[path]
        print(f"[state] pruned stale entry: {path}")


def load_state() -> dict:
    """Load persisted file positions from disk. Returns {} if no state file yet."""
    try:
        with open(STATE_FILE, "r") as f:
            data = json.load(f)
            print(f"Loaded parser state from {STATE_FILE} ({len(data)} files tracked)")
            return data
    except FileNotFoundError:
        print(f"No state file found at {STATE_FILE}, starting fresh")
        return {}
    except Exception as e:
        print(f"Warning: could not load state file ({e}), starting fresh")
        return {}


def save_state(state: dict):
    """Atomically write current file positions to disk."""
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(state, f)
        os.replace(tmp, STATE_FILE)
    except Exception as e:
        print(f"Warning: could not save state file: {e}")


# ── File tailing ──────────────────────────────────────────────────────────────

async def tail_file(path: str, pool: asyncpg.Pool, state: dict):
    """
    Tail a single log file, resuming from the saved position.
    Handles log rotation via inode tracking.
    """
    batch       = []
    last_flush  = time.monotonic()
    last_save   = time.monotonic()

    try:
        f = open(path, "r", errors="replace")
        current_inode = os.fstat(f.fileno()).st_ino

        saved_pos = _get_pos(state, path)
        if saved_pos is not None:
            file_size = os.path.getsize(path)
            if saved_pos <= file_size:
                f.seek(saved_pos)
            else:
                print(f"Log rotated while offline: {path} (saved={saved_pos}, size={file_size})")
                f.seek(0)
                _set_pos(state, path, 0)
        else:
            f.seek(0)
            _set_pos(state, path, 0)

        while True:
            line = f.readline()
            if line:
                record = parse_line(line, path)
                if record:
                    batch.append(record)
                _set_pos(state, path, f.tell())
            else:
                # Check for log rotation (inode change) while running
                try:
                    if os.stat(path).st_ino != current_inode:
                        print(f"Log rotated (inode change): {path}")
                        f.close()
                        f = open(path, "r", errors="replace")
                        current_inode = os.fstat(f.fileno()).st_ino
                        _set_pos(state, path, 0)
                        continue
                except FileNotFoundError:
                    pass

                now = time.monotonic()

                if batch and (now - last_flush >= FLUSH_INTERVAL or len(batch) >= BATCH_SIZE):
                    await insert_batch(pool, batch)
                    batch.clear()
                    last_flush = now

                if now - last_save >= STATE_SAVE_EVERY:
                    save_state(state)
                    last_save = now

                await asyncio.sleep(0.5)

    except Exception as e:
        print(f"Error tailing {path}: {e}")
    finally:
        if batch:
            try:
                await insert_batch(pool, batch)
            except Exception:
                pass
        save_state(state)
        try:
            f.close()
        except Exception:
            pass


# ── Discovery loop ────────────────────────────────────────────────────────────

async def discover_and_tail(pool: asyncpg.Pool):
    """Discover NPM log files and tail them, watching for new files every 30s."""
    state = load_state()
    tasks = {}

    while True:
        pattern       = os.path.join(LOG_DIR, "*_access.log")
        current_files = set(glob.glob(pattern))

        main_log = os.path.join(LOG_DIR, "access.log")
        if os.path.exists(main_log):
            current_files.add(main_log)

        for path in current_files:
            if path not in tasks or tasks[path].done():
                print(f"Tailing: {path}")
                tasks[path] = asyncio.create_task(tail_file(path, pool, state))

        # Prune stale state entries for deleted log files
        _prune_state(state, current_files)

        # Heartbeat for Docker health check
        try:
            open("/tmp/health", "w").write(str(asyncio.get_event_loop().time()))
        except Exception:
            pass

        await asyncio.sleep(30)


# ── Entry point ───────────────────────────────────────────────────────────────

async def main():
    load_geo()
    pool = await connect_with_retry(DATABASE_URL)
    print(f"Watching {LOG_DIR} for NPM access logs…")
    await discover_and_tail(pool)


if __name__ == "__main__":
    asyncio.run(main())
