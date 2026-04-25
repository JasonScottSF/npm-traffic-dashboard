# NPM Traffic Dashboard

A colorful, real-time traffic monitoring dashboard for [Nginx Proxy Manager](https://nginxproxymanager.com/) deployed in Docker.

## Features

- **Live feed** — real-time request stream, refreshes every 3 seconds
- **Traffic charts** — area charts for requests, unique visitors, bandwidth, errors, and bots
- **Time periods** — 24h · 3d · 7d · 30d · 90d · 180d · 360d
- **Per-host filtering** — drill into any proxied host
- **Status code distribution** — 2xx/3xx/4xx/5xx donut chart
- **Top paths, hosts, IPs, referrers**
- **Browser, OS, device type** breakdowns
- **GeoIP country** lookups (optional, requires free MaxMind key)
- **Peak hours heatmap** — traffic by day-of-week × hour
- **Session tracking** — bounced sessions, duration, page counts
- **Bot detection** — automatic classification via user-agent patterns

## Stack

| Service | Image |
|---------|-------|
| `db` | postgres:16-alpine |
| `parser` | Python — tails NPM access logs → Postgres |
| `api` | FastAPI — REST endpoints |
| `frontend` | React/Vite → nginx |

## Quick Start

```bash
# 1. Copy and edit environment file
cp .env.example .env
# Edit .env — set DB_PASSWORD and NPM_LOG_PATH

# 2. (Optional) Add MaxMind key for GeoIP country data
# Free signup: https://www.maxmind.com/en/geolite2/signup
# Add MAXMIND_LICENSE_KEY to .env then:
docker compose run --rm geoip_updater

# 3. Start the stack
docker compose up -d

# 4. Open dashboard
open http://localhost:8080
```

## Finding Your NPM Log Path

SSH into your Docker host and run:
```bash
docker inspect nginx-proxy-manager | grep -A5 '"Mounts"'
# Look for the volume mounted at /data inside the container
# NPM logs live at <host_path>/logs/
```

Common paths:
- `/opt/npm/data/logs`
- `/docker/nginx-proxy-manager/data/logs`
- `/home/user/npm/data/logs`

Set `NPM_LOG_PATH` in `.env` to point to that directory.

## NPM Log Format

The parser expects NPM's default nginx log format:
```
$host $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
```

It auto-discovers all `*_access.log` files in the log directory and tails them, handling log rotation.

## Updating GeoIP Database

```bash
docker compose run --rm geoip_updater
docker compose restart parser
```

MaxMind updates GeoLite2 databases twice a week.
