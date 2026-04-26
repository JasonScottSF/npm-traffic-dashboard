#!/usr/bin/env python3
"""
seed-dev.py — populate the dashboard DB with realistic fake traffic for dev/testing.

Usage (run from the repo root):
  docker exec -i npm_dashboard_db psql -U dashboard -d npm_dashboard \
    < <(python3 scripts/seed-dev.py)

Or directly against the DB:
  python3 scripts/seed-dev.py | docker exec -i npm_dashboard_db psql -U dashboard -d npm_dashboard
"""

import random
import sys
from datetime import datetime, timedelta, timezone

# ── Config ────────────────────────────────────────────────────────────────────

DAYS        = 7       # how many days of history to generate
REQ_PER_DAY = 1200    # average requests per day
HOSTS = [
    "app.example.com",
    "api.example.com",
    "static.example.com",
]

PATHS = [
    "/", "/about", "/login", "/dashboard", "/api/v1/status",
    "/api/v1/users", "/api/v1/data", "/assets/logo.png",
    "/assets/main.css", "/assets/bundle.js", "/favicon.ico",
    "/robots.txt", "/sitemap.xml", "/health",
    "/admin", "/wp-login.php", "/.env", "/config.php",  # scanners
]

STATUS_WEIGHTS = [
    (200, 65), (301, 5), (302, 5), (304, 8),
    (400, 3),  (401, 3), (403, 2), (404, 5), (500, 2), (502, 2),
]

COUNTRIES = [
    ("US", 40), ("GB", 10), ("DE", 8), ("FR", 7), ("CA", 6),
    ("AU", 5),  ("IN", 5),  ("BR", 4), ("NL", 3), ("CN", 3),
    ("RU", 3),  ("JP", 3),  (None, 3),
]

IPS = [
    "203.0.113.1", "203.0.113.2", "203.0.113.42", "198.51.100.7",
    "198.51.100.55", "192.0.2.100", "192.0.2.200", "10.0.0.5",
    "172.16.0.1", "1.2.3.4", "5.6.7.8", "9.10.11.12",
    "77.88.55.60", "185.220.101.1", "195.123.245.100",
]

BROWSERS = [
    ("Chrome",  40), ("Firefox", 20), ("Safari", 15),
    ("Edge",    10), ("Bot",     10), ("Unknown", 5),
]

DEVICES = {
    "Chrome":  "desktop", "Firefox": "desktop", "Safari": "mobile",
    "Edge":    "desktop", "Bot":     "bot",      "Unknown": "desktop",
}

UAS = {
    "Chrome":  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    "Firefox": "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Safari":  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15",
    "Edge":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/124.0",
    "Bot":     "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Unknown": "-",
}

METHODS = [("GET", 80), ("POST", 15), ("PUT", 3), ("DELETE", 2)]

REFERERS = [
    None, None, None,  # most requests have no referer
    "https://google.com/", "https://bing.com/", "https://github.com/",
    "https://app.example.com/", "https://twitter.com/",
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def weighted_choice(weighted):
    population = [v for v, w in weighted for _ in range(w)]
    return random.choice(population)

def rand_bytes(status, method):
    if status in (301, 302, 304):
        return random.randint(0, 200)
    if method == "GET":
        return random.randint(500, 150_000)
    return random.randint(100, 5_000)

# ── Generate SQL ──────────────────────────────────────────────────────────────

now   = datetime.now(timezone.utc)
start = now - timedelta(days=DAYS)

rows = []
total = DAYS * REQ_PER_DAY

for _ in range(total):
    # Spread across the time range with realistic day/night weighting
    offset_secs = random.uniform(0, DAYS * 86400)
    ts = start + timedelta(seconds=offset_secs)

    # Simulate lower traffic at night (0-6 UTC)
    if ts.hour < 6 and random.random() < 0.6:
        continue

    host       = random.choice(HOSTS)
    path       = random.choice(PATHS)
    method     = weighted_choice(METHODS)
    status     = weighted_choice(STATUS_WEIGHTS)
    country    = weighted_choice(COUNTRIES)
    ip         = random.choice(IPS)
    browser    = weighted_choice(BROWSERS)
    device     = DEVICES[browser]
    ua         = UAS[browser]
    is_bot     = browser == "Bot"
    bytes_sent = rand_bytes(status, method)
    referer    = random.choice(REFERERS)

    rows.append((ts, host, ip, method, path, status, bytes_sent,
                 referer, ua, country, is_bot, browser, device))

# Sort chronologically
rows.sort(key=lambda r: r[0])

# Emit SQL
print("BEGIN;")
print("""
INSERT INTO requests
  (ts, host, client_ip, method, path, status_code, bytes_sent,
   referer, user_agent, country_code, is_bot, browser, device_type)
VALUES""")

formatted = []
for (ts, host, ip, method, path, status, bsent,
     referer, ua, country, is_bot, browser, device) in rows:

    def q(v):
        if v is None:
            return "NULL"
        return "'" + str(v).replace("'", "''") + "'"

    formatted.append(
        f"  ({q(ts.isoformat())}, {q(host)}, {q(ip)}::inet, {q(method)}, "
        f"{q(path)}, {status}, {bsent}, "
        f"{q(referer)}, {q(ua)}, {q(country)}, "
        f"{'TRUE' if is_bot else 'FALSE'}, {q(browser)}, {q(device)})"
    )

print(",\n".join(formatted) + ";")
print("COMMIT;")
print(f"\n-- Seeded {len(rows)} requests across {DAYS} days", file=sys.stderr)
