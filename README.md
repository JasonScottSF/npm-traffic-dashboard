# NPM Traffic Dashboard

A self-hosted monitoring and security stack built around Nginx Proxy Manager. Includes real-time traffic analytics, MFA-protected login, fail2ban integration, host system monitoring, automated backups, and Route53 DDNS — all deployable from a single `docker compose up`.

---

## Table of Contents

1. [What's in the stack](#whats-in-the-stack)
2. [Prerequisites](#prerequisites)
3. [Fresh install](#fresh-install)
4. [First-time configuration](#first-time-configuration)
5. [Dashboard overview](#dashboard-overview)
6. [Authentication and user management](#authentication-and-user-management)
7. [Security](#security)
8. [Backup and restore](#backup-and-restore)
9. [DDNS (Route53)](#ddns-route53)
10. [Routine operations](#routine-operations)
11. [Port reference](#port-reference)
12. [Troubleshooting](#troubleshooting)

---

## What's in the stack

| Service | Image / Tech | Purpose |
|---------|-------------|---------|
| `npm` | jc21/nginx-proxy-manager | Reverse proxy, SSL termination, access logging |
| `db` | postgres:16-alpine | Stores all parsed traffic data |
| `parser` | Python 3.12 | Tails NPM access logs and writes to Postgres |
| `geoip_updater` | Python 3.12 | Downloads and refreshes MaxMind GeoLite2 database |
| `api` | FastAPI | Traffic data REST API |
| `auth` | FastAPI | Login, MFA (TOTP), session management, user admin |
| `fail2ban-server` | crazymax/fail2ban | Fail2ban daemon with host iptables access |
| `fail2ban` | Python | Fail2ban REST API for the dashboard |
| `sysmon` | Python + psutil | Host CPU, memory, network, process stats |
| `backup` | Alpine | Hourly backup of all data to private git repo |
| `frontend` | React/Vite + nginx | Dashboard UI with auth enforcement |

All services communicate on an internal Docker bridge network. Only NPM (80/443/81) and the dashboard direct-access port (8090) are exposed externally.

---

## Prerequisites

- Ubuntu 22.04 or 24.04 (fresh VM recommended)
- Ports 80, 443, 81, and 8090 open in your firewall
- A private GitHub repo for backups (see [Backup and restore](#backup-and-restore))
- Optional: MaxMind account for GeoIP country data (free)

---

## Fresh install

### Option A — Setup script (recommended)

Installs Docker if needed, walks through `.env` configuration interactively, and starts the stack.

```bash
git clone https://github.com/JasonScottSF/npm-traffic-dashboard.git
cd npm-traffic-dashboard
git checkout feature/npm-stack
sudo bash setup.sh
```

When it finishes, continue to [First-time configuration](#first-time-configuration).

---

### Option B — Manual

#### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in for the group change to take effect
```

#### 2. Clone the repo

```bash
git clone https://github.com/JasonScottSF/npm-traffic-dashboard.git
cd npm-traffic-dashboard
git checkout feature/npm-stack
```

#### 3. Create and edit `.env`

```bash
cp .env.example .env
nano .env
```

Fill in every value. See `.env.example` for descriptions. At minimum you must set:

| Variable | Description |
|----------|-------------|
| `DB_PASSWORD` | Strong password for Postgres (12+ chars) |
| `BACKUP_GITHUB_TOKEN` | GitHub PAT with `repo` scope on your backup repo |

#### 4. Seed GeoIP data (optional but recommended)

```bash
docker compose run --rm geoip_updater
```

Requires `MAXMIND_LICENSE_KEY` in `.env`. Sign up free at [maxmind.com](https://www.maxmind.com/en/geolite2/signup).

#### 5. Start the stack

```bash
docker compose up -d
```

#### 6. Verify all services are running

```bash
docker compose ps
```

Every service should show `Up`. If any show `Restarting`, check its logs:

```bash
docker logs <container_name> --tail 50
```

---

## First-time configuration

### NPM (Nginx Proxy Manager)

Open `http://your-server-ip:81`

**Default credentials:**
- Email: `admin@example.com`
- Password: `changeme`

**Change these immediately** — NPM will prompt you on first login.

Once logged in, add a proxy host for each service you want to expose:

1. **Hosts → Proxy Hosts → Add Proxy Host**
2. Set the domain name (e.g. `dash.yourdomain.com`)
3. Forward hostname: `npm_dashboard_frontend`, port: `80`
4. Enable **SSL** and request a Let's Encrypt certificate
5. Repeat for any other services

The parser and fail2ban watch NPM's access logs automatically — traffic data appears in the dashboard within minutes of your first proxy host receiving requests.

### Dashboard

Open `http://your-server-ip:8090`

On first visit with no users in the system, the login page shows an **admin creation form**:

1. Enter a username and password (12+ chars recommended)
2. You will be redirected to MFA setup — scan the QR code with Google Authenticator, Authy, or 1Password
3. Enter the 6-digit code to confirm setup
4. You now have full access

---

## Dashboard overview

| Tab | What it shows |
|-----|--------------|
| **Overview** | Live request feed, traffic over time, HTTP status code breakdown, top hosts |
| **Traffic** | Per-host and per-path request/bandwidth charts, configurable time period |
| **Visitors** | Top IPs, referrers, peak hours heatmap |
| **Geo** | Requests and unique visitors by country |
| **Tech** | Browser, OS, and device type breakdown |
| **Security** | Fail2ban jail status, banned IPs with one-click unban, manual IP block, live log feed |
| **Host** | CPU usage and load averages, memory and swap, network interfaces, temperatures, top processes |

**Timezone selector** — the dropdown in the header applies to all charts, heatmaps, and timestamps. Defaults to US Pacific. Selection is saved in browser localStorage.

**Time period selector** — all traffic charts support: `24h · 3d · 7d · 30d · 90d · 180d · 360d`. Historical data is backfilled from NPM logs on first run.

---

## Authentication and user management

All dashboard routes require login. The auth service enforces:

- **bcrypt** password hashing
- **TOTP MFA** (6-digit codes, compatible with any authenticator app)
- **JWT session cookies** — 8-hour expiry, `httpOnly`, `SameSite=Strict`, `Secure`
- **Rate limiting** — nginx limits login attempts to 10/minute with a burst of 5

### Managing users

Admins see a **👥 Users** button in the dashboard header. From there you can:

- **Create a user** — set username, password, and whether they are an admin. New users must complete MFA setup on their first login before they can access the dashboard.
- **Reset a password** — inline form per user. Resets the password and clears their TOTP — they re-enroll MFA on next login.
- **Delete a user** — permanent, requires confirmation.

### Signing out

Click your username in the header → **Sign out**. The session cookie is cleared.

---

## Security

### Fail2ban jails

| Jail | What triggers it | Ban duration |
|------|-----------------|-------------|
| `dashboard-login` | 5 failed dashboard logins within 10 minutes | 1 hour |
| `npm-http-auth` | 10 HTTP 401 responses within 5 minutes | 30 minutes |
| `npm-badbots` | Any single request from a known scanner or scraper | Permanent |
| `npm-404` | 10 requests to non-existent pages within 2 minutes | 1 hour |
| `sshd` | 3 failed SSH logins | 24 hours |
| `manual-ban` | Manual block added via the dashboard UI | Permanent |

**Bots blocked permanently on first request (`npm-badbots`):**

Vulnerability scanners: `masscan`, `nikto`, `nmap`, `sqlmap`, `zgrab`, `nuclei`, `dirbuster`, `gobuster`, `ffuf`, `wfuzz`, `hydra`, `medusa`, `burp`, `acunetix`, `nessus`, `openvas`

Aggressive scrapers: `AhrefsBot`, `MJ12bot`, `DotBot`, `SemrushBot`, `BLEXBot`, `MajesticSEO`, `Bytespider`, `GPTBot`, `CCBot`, `PetalBot`, `DataForSeoBot`, `SiteAuditBot`

Generic scraper clients: `python-requests`, `Go-http-client/1.1`, `Scrapy`, `curl/`

### Manual IP blocking

From the **Security** tab, enter any IP address, CIDR, or subnet into the **Manual Block** field and click Ban. Examples: `203.0.113.5`, `192.168.0.0/16`. Manual bans are permanent and survive container restarts.

To unban, click the **Unban** button next to the entry in the Manual Blocks list.

### Geo blocking

The Security tab includes a **GeoBlock** panel. Enter two-letter ISO country codes to block all traffic from those countries at the fail2ban/iptables level.

---

## Backup and restore

Backups run automatically every 60 minutes. Each backup is a git commit to the private [JasonScottSF/Proxy](https://github.com/JasonScottSF/Proxy) repository, giving you a full timeline you can roll back to.

### What gets backed up

| File in backup repo | Contents |
|--------------------|---------|
| `.env` | All environment configuration and secrets |
| `db.sql.gz` | Full Postgres database dump (compressed) |
| `npm_data.tar.gz` | NPM proxy host config, SSL certificates |
| `auth_data.tar.gz` | Auth service database (users, MFA secrets) |
| `fail2ban_data.tar.gz` | Fail2ban state and ban history |

### Setting up backups

1. Create a GitHub Personal Access Token with `repo` scope at **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Add it to `.env` on the server: `BACKUP_GITHUB_TOKEN=your_token_here`
3. Start the backup container: `docker compose up -d backup`

Check it is working:

```bash
docker logs npm_backup --tail 30
```

You should see a successful push to the backup repo within a minute of starting.

### Viewing backup history

```bash
# On your local machine or the server
git clone https://github.com/JasonScottSF/Proxy.git
cd Proxy
git log --oneline
```

Each commit is timestamped and contains a full snapshot of all data.

### Disaster recovery — full restore

On a **fresh Ubuntu VM** with nothing installed, run:

```bash
curl -fsSL https://raw.githubusercontent.com/JasonScottSF/npm-traffic-dashboard/feature/npm-stack/restore.sh | sudo bash
```

The script will:
1. Install Docker via the official convenience script
2. Prompt for your backup repo GitHub token
3. Clone both the main repo and the backup repo
4. Restore all Docker volumes from the backup
5. Restore the Postgres database
6. Start the full stack

When it completes, NPM and the dashboard are running with all your data, proxy hosts, SSL certificates, and user accounts intact.

### Restoring from a specific point in time

To recover from a backup older than the latest:

```bash
# Find the commit you want
git -C /tmp/Proxy log --oneline

# Set the commit hash before running restore
RESTORE_COMMIT=abc1234 bash restore.sh
```

---

## DDNS (Route53)

The `ddns/` directory contains a standalone updater that keeps your Route53 DNS records pointed at your current external IP. It discovers all domains configured in NPM automatically — no manual list to maintain.

It runs as a **separate container outside the main stack** since it contains personal AWS credentials.

### IAM setup

Create a dedicated IAM user — never use root credentials.

1. **AWS Console → IAM → Users → Create user** — name it `ddns-updater`, no console access needed
2. On the user's **Permissions** tab → **Add permissions → Create inline policy → JSON** — paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets"
      ],
      "Resource": "arn:aws:route53:::hostedzone/YOUR_ZONE_ID"
    }
  ]
}
```

3. **Security credentials → Create access key** — use case: *Application running outside AWS*. Copy the key ID and secret — you will not see the secret again.

### Running the DDNS updater

```bash
cd ~/npm-traffic-dashboard/ddns
cp .env.example .env
nano .env   # fill in NPM URL, NPM credentials, AWS keys, zone ID
docker compose up -d
```

View logs:

```bash
docker logs -f ddns_route53
```

The updater checks every 5 minutes by default. Records are only updated when the external IP has actually changed.

---

## Routine operations

### Updating the stack

```bash
cd ~/npm-traffic-dashboard
git pull
docker compose up -d --build
```

### Updating GeoIP data

MaxMind releases updated databases twice a week.

```bash
docker compose run --rm geoip_updater
docker compose restart parser
```

### Checking backup status

```bash
docker logs npm_backup --tail 20
```

### Restarting a single service

```bash
docker compose restart <service_name>
# e.g. docker compose restart parser
```

### Viewing all logs

```bash
docker compose logs -f
# Or a specific service:
docker compose logs -f api
```

### Stopping the stack

```bash
docker compose down
# To also remove volumes (destructive — backup first):
docker compose down -v
```

---

## Port reference

| Service | Port | Accessible from |
|---------|------|----------------|
| NPM HTTP | 80 | External |
| NPM HTTPS | 443 | External |
| NPM admin UI | 81 | External (firewall to trusted IPs) |
| Dashboard (direct) | 8090 | External |
| Traffic API | 8000 | Internal only |
| Auth API | 8003 | Internal only |
| Fail2ban API | 8001 | Internal only |
| Sysmon API | 8002 | Internal only |
| Postgres | 5432 | Internal only |

**Recommendation:** firewall port 81 (NPM admin) and port 8090 (direct dashboard) to your trusted IP ranges. All production traffic should go through NPM on 80/443.

---

## Troubleshooting

### A service is restarting repeatedly

```bash
docker compose ps                        # identify which service
docker logs <container_name> --tail 50   # read the error
```

The most common cause is a missing or incorrect `.env` value.

### No traffic data in the dashboard

```bash
docker logs npm_log_parser --tail 50
```

Check that NPM has at least one proxy host configured and has received traffic. The parser only sees data after NPM creates log files.

Verify the database has data:

```bash
docker exec npm_dashboard_db psql -U dashboard -d npm_dashboard -c "SELECT COUNT(*) FROM requests;"
```

### Fail2ban shows as disconnected

```bash
docker logs npm_fail2ban_api --tail 30
docker logs npm_fail2ban_server --tail 30
```

The fail2ban server container uses `network_mode: host` and writes its socket to a shared volume. If the socket is missing, restart the server container first:

```bash
docker compose restart fail2ban-server
docker compose restart fail2ban
```

### No GeoIP country data

Run the updater and confirm it succeeds:

```bash
docker compose run --rm geoip_updater
docker compose restart parser
```

Requires `MAXMIND_LICENSE_KEY` in `.env`.

### Dashboard login redirects immediately back to login

Ensure `COOKIE_SECURE=false` is **not** set when accessing over HTTPS. If accessing over plain HTTP (no TLS), set `COOKIE_SECURE=false` in `.env` and restart the auth container.

```bash
docker compose restart auth
```

### Backup container is not pushing

```bash
docker logs npm_backup --tail 50
```

Common causes:
- `BACKUP_GITHUB_TOKEN` is missing or expired — generate a new token and update `.env`
- The backup repo is unreachable — check internet access from the container: `docker exec npm_backup wget -q -O- https://github.com`

### Temperatures not showing on Host tab

Normal on VMs and cloud instances — temperature sensors are not exposed by the hypervisor. No action needed.
