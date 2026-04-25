# NPM Traffic Dashboard

A colorful, real-time monitoring dashboard for servers running [Nginx Proxy Manager](https://nginxproxymanager.com/) in Docker. Includes traffic analytics, fail2ban security monitoring, and host system stats — all in one dark-themed UI.

---

## Screenshots

| Tab | What you see |
|-----|-------------|
| **Overview** | Live request feed, traffic chart, status codes, top hosts |
| **Traffic** | Requests/bandwidth by host and path, time-series charts |
| **Visitors** | Top IPs, referrers, peak hours heatmap |
| **Geo** | Top countries by requests and unique visitors |
| **Tech** | Browser, OS, device type breakdowns |
| **Security** | Fail2ban status, jails, banned IPs with one-click unban, live log feed |
| **Host** | CPU, memory, disk, network interfaces, temperatures, top processes |

---

## Stack

| Service | Image / Tech | Purpose |
|---------|-------------|---------|
| `db` | postgres:16-alpine | Stores all parsed request data |
| `parser` | Python 3.12 | Tails NPM access logs → Postgres |
| `geoip_updater` | Python 3.12 | Downloads MaxMind GeoLite2 DB |
| `api` | FastAPI | Traffic data REST API |
| `fail2ban` | Python + fail2ban-client | Fail2ban status/control API |
| `sysmon` | Python + psutil | Host system stats API |
| `frontend` | React/Vite → nginx | Dashboard UI |

---

## Quick Start

### 1. Clone

```bash
git clone https://github.com/JasonScottSF/npm-traffic-dashboard.git
cd npm-traffic-dashboard
```

### 2. Configure

```bash
cp .env.example .env
nano .env
```

Required settings:

```env
# Strong password for Postgres
DB_PASSWORD=your_secure_password

# Path on the host where NPM writes its access logs
# Run: docker inspect <npm-container> | grep -A2 '"/data"'
# Logs are at <host_path>/logs/
NPM_LOG_PATH=/home/user/npm/data/logs

# Port to serve the dashboard on
DASHBOARD_PORT=8080
```

Optional:

```env
# Free MaxMind account for GeoIP country lookups
# Sign up: https://www.maxmind.com/en/geolite2/signup
MAXMIND_LICENSE_KEY=your_key_here

# Path to fail2ban log (default /var/log works for most systems)
F2B_LOG_PATH=/var/log
```

### 3. GeoIP (optional but recommended)

```bash
docker compose run --rm geoip_updater
```

### 4. Start

```bash
docker compose up -d
```

Open `http://your-server-ip:8080`

---

## Finding Your NPM Log Path

```bash
# Find the NPM container name
docker ps --format "{{.Names}}\t{{.Image}}" | grep proxy

# Find where /data is mounted on the host
docker inspect <container-name> | grep -B1 '"/data"'
# Look for "Source" — that's the host path
# NPM logs live at <host_path>/logs/
```

Common paths:
- `/opt/npm/data/logs`
- `/home/user/npm/data/logs`  
- `/docker/nginx-proxy-manager/data/logs`

---

## NPM Log Format

The parser auto-detects NPM's log format:

```
[19/Apr/2026:16:01:13 +0000] - 200 200 - GET https example.com "/" [Client 1.2.3.4] [Length 2008] [Gzip -] [Sent-to 192.168.1.10] "Mozilla/5.0..." "-"
```

It automatically discovers all `*_access.log` files and tails them, handling log rotation. On startup it backfills all historical log data.

---

## Fail2Ban Integration

The `fail2ban` service mounts the host's fail2ban socket and provides:

- Real-time jail status and banned IP counts
- Per-jail banned IP list with one-click unban
- Live log feed filterable by jail
- Manual ban/unban via the UI

**Requirement:** fail2ban must be running on the Docker host with its socket at `/var/run/fail2ban/fail2ban.sock`.

---

## Host Monitoring

The `sysmon` service uses `psutil` with `pid: host` to report:

- CPU usage, frequency, load averages, sparkline history
- Memory (RAM + swap) usage with sparklines
- Disk usage per mount point
- Network interface stats (bytes in/out, errors)
- Temperature sensors (if available)
- Top 15 processes by CPU

---

## Updating GeoIP

MaxMind updates the GeoLite2 database twice a week. To update:

```bash
docker compose run --rm geoip_updater
docker compose restart parser
```

---

## Time Periods

All traffic charts support: **24h · 3d · 7d · 30d · 90d · 180d · 360d**

Select from the header. Historical data is backfilled from NPM logs on first run.

---

## Ports

| Service | Internal Port |
|---------|--------------|
| Frontend (dashboard) | `${DASHBOARD_PORT}` (default 8080) |
| Traffic API | 8000 (internal only) |
| Fail2Ban API | 8001 (internal only) |
| Sysmon API | 8002 (internal only) |
| Postgres | 5432 (internal only) |

All API services are accessible only within the Docker network — the nginx frontend proxies all `/api/` requests.

---

## Troubleshooting

**No traffic data showing**
```bash
docker logs npm_log_parser
docker exec npm_dashboard_db psql -U dashboard -d npm_dashboard -c "SELECT COUNT(*) FROM requests;"
```
Check that `NPM_LOG_PATH` points to the directory containing `*_access.log` files.

**Fail2ban shows as down**
```bash
docker logs npm_fail2ban_api
ls -la /var/run/fail2ban/fail2ban.sock
```
The socket must exist and be readable. You may need to adjust socket permissions: `sudo chmod 660 /var/run/fail2ban/fail2ban.sock`

**No GeoIP country data**
Run `docker compose run --rm geoip_updater` — requires `MAXMIND_LICENSE_KEY` in `.env`.

**Temperatures not showing**
Not all systems expose temperature sensors. This is normal on VMs and some cloud instances.
