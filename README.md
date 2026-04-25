# NPM Traffic Dashboard

A real-time monitoring dashboard for servers running [Nginx Proxy Manager](https://nginxproxymanager.com/) in Docker. Includes traffic analytics, fail2ban security monitoring, MFA-protected login, automatic threat IP blocking, and host system stats — all in a dark-themed UI.

---

## Screenshots

| Tab | What you see |
|-----|-------------|
| **Overview** | Live request feed, traffic chart, status codes, top hosts |
| **Traffic** | Requests/bandwidth by host and path, time-series charts |
| **Visitors** | Top IPs, referrers, peak hours heatmap |
| **Geo** | Top countries by requests and unique visitors |
| **Tech** | Browser, OS, device type breakdowns |
| **Security** | Fail2ban jails, banned IPs, manual IP/CIDR block, live log feed |
| **Host** | CPU, memory, network interfaces, temperatures, top processes |

---

## Stack

| Service | Image / Tech | Purpose |
|---------|-------------|---------|
| `db` | postgres:16-alpine | Stores all parsed request data |
| `parser` | Python 3.12 | Tails NPM access logs → Postgres |
| `geoip_updater` | Python 3.12 | Downloads MaxMind GeoLite2 DB |
| `api` | FastAPI | Traffic data REST API |
| `auth` | FastAPI | Login, MFA (TOTP), session management, user admin |
| `fail2ban` | Python + fail2ban-client | Fail2ban status/control API |
| `sysmon` | Python + psutil | Host system stats API |
| `frontend` | React/Vite → nginx | Dashboard UI |

---

## Quick Start

### Option A — Setup script (recommended for fresh hosts)

The setup script installs Docker if it isn't present (via the official [get.docker.com](https://get.docker.com) convenience script), walks you through `.env` configuration interactively, and starts the stack.

```bash
git clone https://github.com/JasonScottSF/npm-traffic-dashboard.git
cd npm-traffic-dashboard
sudo bash setup.sh
```

That's it. Skip to [First Login](#first-login) when it finishes.

---

### Option B — Manual setup

#### 1. Install Docker

If Docker isn't already installed, use the official convenience script:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # then log out and back in
```

#### 2. Clone

```bash
git clone https://github.com/JasonScottSF/npm-traffic-dashboard.git
cd npm-traffic-dashboard
```

#### 3. Configure

```bash
cp .env.example .env
nano .env
```

Required settings:

```env
DB_PASSWORD=your_secure_password
```

Optional:

```env
# Free MaxMind account for GeoIP country lookups
# Sign up: https://www.maxmind.com/en/geolite2/signup
MAXMIND_LICENSE_KEY=your_key_here

# Display name shown on the login page
APP_NAME=NPM Dashboard

# Port for direct dashboard access (bypassing NPM)
DASHBOARD_PORT=8090

# Set to false only for local HTTP testing without TLS
COOKIE_SECURE=true

# Timezone for fail2ban
TZ=America/Los_Angeles
```

#### 4. GeoIP (optional but recommended)

```bash
docker compose run --rm geoip_updater
```

#### 5. Start

```bash
docker compose up -d
```

---

## First Login

Open `http://your-server-ip:8090` — you'll be redirected to the login page.

**NPM admin** (port 81): default credentials are `admin@example.com` / `changeme`. Change them immediately.

**Dashboard:** no users exist on first run. The login page shows an admin creation form — set a username and password, then complete TOTP setup (Google Authenticator, Authy, 1Password, etc.) before you gain access.

---

## Authentication & MFA

All dashboard routes are protected by a login wall backed by the `auth` service.

**First run:** If no users exist, the login page shows an admin creation form. Set a username and password — you'll be walked through TOTP setup (Google Authenticator, Authy, etc.) before gaining access.

**Subsequent logins:** Enter username → password → 6-digit TOTP code.

**User management:** Admins can create, delete, and reset passwords for other users from the Users panel (👥 icon in the header). New users complete MFA setup on their first login.

**Session:** JWT cookie, 8-hour expiry, `httpOnly` + `SameSite=Strict` + `Secure`.

---

## Security Features

### Fail2Ban Jails

| Jail | Trigger | Ban |
|------|---------|-----|
| `dashboard-login` | 5 failed dashboard logins in 10 min | 1 hour |
| `npm-http-auth` | 10 HTTP 401s in 5 min | 30 min |
| `npm-badbots` | Any request from a known scanner or scraper UA | Permanent |
| `npm-404` | 10 requests to non-existent pages in 2 min | 1 hour |
| `sshd` | 3 failed SSH logins | 24 hours |
| `manual-ban` | Manual block via UI | Permanent |

**Known bots blocked permanently by `npm-badbots`:**
- Vulnerability scanners: `masscan`, `nikto`, `nmap`, `sqlmap`, `zgrab`, `nuclei`, `dirbuster`, `gobuster`, `ffuf`, `wfuzz`, `hydra`, `medusa`, `burp`, `acunetix`, `nessus`, `openvas`
- Aggressive scrapers: `AhrefsBot`, `MJ12bot`, `DotBot`, `SemrushBot`, `BLEXBot`, `MajesticSEO`, `Bytespider`, `GPTBot`, `CCBot`, `PetalBot`, `DataForSeoBot`, `SiteAuditBot`
- Generic scraper clients: `python-requests`, `Go-http-client/1.1`, `Scrapy`, `curl/`

### Manual Blocks

From the **Security** tab you can manually ban any IP, CIDR, or subnet (e.g. `192.168.1.5`, `10.0.0.0/8`). Manual bans are permanent and survive container restarts.

---

## Timezone

The timezone selector in the dashboard header applies to all charts, heatmaps, and timestamps. Defaults to **US Pacific**. Your selection is saved in browser localStorage. 16 timezones are available across all major regions.

---

## Time Periods

All traffic charts support: **24h · 3d · 7d · 30d · 90d · 180d · 360d**

Historical data is backfilled from NPM logs on first run.

---

## Ports

| Service | Internal Port |
|---------|--------------|
| NPM (HTTP/HTTPS) | 80 / 443 |
| NPM admin | 81 |
| Frontend (direct access) | `${DASHBOARD_PORT}` (default 8090) |
| Traffic API | 8000 (internal only) |
| Fail2Ban API | 8001 (internal only) |
| Auth API | 8003 (internal only) |
| Sysmon API | 8002 (internal only) |
| Postgres | 5432 (internal only) |

All API services are accessible only within the Docker network.

---

## Updating GeoIP

MaxMind updates GeoLite2 twice a week. To update:

```bash
docker compose run --rm geoip_updater
docker compose restart parser
```

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
The socket must exist and be readable. You may need: `sudo chmod 660 /var/run/fail2ban/fail2ban.sock`

**Blocklist not loading**
```bash
docker logs npm_blocklist
```
The container needs internet access to reach GitHub and Spamhaus. Check firewall rules if running in a restricted environment.

**No GeoIP country data**
Run `docker compose run --rm geoip_updater` — requires `MAXMIND_LICENSE_KEY` in `.env`.

**Temperatures not showing**
Not all systems expose temperature sensors. This is normal on VMs and some cloud instances.

**Redirected to login after every page refresh**
Set `COOKIE_SECURE=false` in `.env` if accessing the dashboard over plain HTTP (no TLS). For production, use HTTPS.
