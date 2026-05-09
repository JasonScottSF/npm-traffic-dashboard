import asyncio
import os
import subprocess
import time
from datetime import datetime, timezone

import asyncpg


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


DATABASE_URL  = os.environ["DATABASE_URL"]
TRIGGER_FILE  = "/trigger/upgrade_now"
UPGRADE_HOUR  = int(os.environ.get("UPGRADE_HOUR", "3"))


def log(msg):
    print(f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} [upgrader] {msg}", flush=True)


async def ensure_table(conn):
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS system_upgrades (
            id          BIGSERIAL PRIMARY KEY,
            ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            exit_code   INT NOT NULL DEFAULT 0,
            packages    TEXT,
            stdout      TEXT,
            duration_s  INT
        )
    """)


def extract_packages(output: str) -> str:
    """Return newline-separated 'name (version)' strings from apt output."""
    pkgs = []
    for line in output.splitlines():
        if line.startswith("Setting up "):
            parts = line.split()
            if len(parts) >= 3:
                pkgs.append(f"{parts[2]} {parts[3]}" if len(parts) > 3 else parts[2])
    return "\n".join(pkgs) if pkgs else "(none)"


async def run_upgrade():
    log("Running apt-get update && apt-get upgrade -y on host via nsenter…")
    start = time.time()

    result = subprocess.run(
        [
            "nsenter", "-t", "1", "-m", "-u", "-i", "-n", "--",
            "sh", "-c",
            "apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y",
        ],
        capture_output=True,
        text=True,
    )

    duration = int(time.time() - start)
    stdout   = (result.stdout + result.stderr)[:20000]
    packages = extract_packages(stdout)
    pkg_count = 0 if packages == "(none)" else len(packages.splitlines())

    log(f"Done (exit {result.returncode}, {duration}s, {pkg_count} packages upgraded)")

    pool = await asyncpg.create_pool(DATABASE_URL, password=_read_secret("db_password"))
    async with pool.acquire() as conn:
        await ensure_table(conn)
        await conn.execute(
            "INSERT INTO system_upgrades (exit_code, packages, stdout, duration_s) VALUES ($1, $2, $3, $4)",
            result.returncode, packages, stdout, duration,
        )
    await pool.close()


async def main():
    log("Upgrader started.")

    # Ensure table exists on startup
    pool = await asyncpg.create_pool(DATABASE_URL, password=_read_secret("db_password"))
    async with pool.acquire() as conn:
        await ensure_table(conn)
    await pool.close()

    last_scheduled_date = None

    while True:
        if os.path.exists(TRIGGER_FILE):
            os.remove(TRIGGER_FILE)
            log("Manual trigger detected.")
            try:
                await run_upgrade()
            except Exception as e:
                log(f"Upgrade failed: {e}")

        now = datetime.now(timezone.utc)
        if now.hour == UPGRADE_HOUR and now.date() != last_scheduled_date:
            last_scheduled_date = now.date()
            log("Scheduled daily run.")
            try:
                await run_upgrade()
            except Exception as e:
                log(f"Scheduled upgrade failed: {e}")

        await asyncio.sleep(30)


if __name__ == "__main__":
    asyncio.run(main())
