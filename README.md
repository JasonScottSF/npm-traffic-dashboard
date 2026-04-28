# NPM Traffic Dashboard

A self-hosted monitoring and security stack built around Nginx Proxy Manager. Includes real-time traffic analytics, MFA-protected login, WAF (ModSecurity CRS), fail2ban integration, breach detection, IP reputation, host system monitoring, automated backups, and Route53 DDNS — all deployable from a single `docker compose up`.

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
| `fail2ban` | Python | Fail2ban REST API + geo-block CIDR management |
| `sysmon` | Python + psutil | Host CPU, memory, network, process stats |
| `waf` | OWASP ModSecurity CRS + nginx | Web Application Firewall; sits in front of the dashboard |
| `waf-api` | FastAPI | Reads ModSecurity audit logs, exposes WAF events to dashboard |
| `waf-tester` | Python | Automated WAF rule-set regression tests |
| `breach-detector` | Python (transparent proxy) | Inspects traffic for WAF bypass attempts; sits between WAF and frontend |
| `log-rotator` | Alpine + logrotate | Rotates WAF audit logs so they don't fill the volume |
| `backup` | Alpine | Hourly backup of all data to private git repo |
| `frontend` | React/Vite + nginx | Dashboard UI with auth enforcement |

### Traffic path

```
Internet → NPM (80/443) → WAF (8080) → breach-detector (8090) → frontend (80)
                                                                   ↕
                                                             api / auth / fail2ban / sysmon / waf-api
```

Direct LAN access (bypasses WAF): `http://<host>:DASHBOARD_PORT`

---

## Prerequisites

- Ubuntu 22.04 or 24.04 (fresh VM recommended)
- Ports 80, 443, 81, and 8090 open in your firewall
- A private GitHub repo for backups (see [Backup and restore](#backup-and-restore))
- Optional: MaxMind account for GeoIP country data (free)
- Optional: AbuseIPDB account for IP reputation data (free)

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

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_PASSWORD` | ✅ | Strong password for Postgres (12+ chars) |
| `BACKUP_GITHUB_TOKEN` | ✅ | GitHub PAT with `repo` scope on your backup repo |
| `MAXMIND_LICENSE_KEY` | optional | MaxMind free account key for GeoIP country data |
| `ABUSEIPDB_KEY` | optional | AbuseIPDB API key for IP reputation scores |
| `WAF_MODE` | optional | `DetectionOnly` (default) or `On` to enable active blocking |
| `WHITELIST_CIDRS` | optional | Space-separated CIDRs to whitelist in WAF and fail2ban (e.g. `10.0.0.0/8 192.168.1.0/24`) |
| `DASHBOARD_PORT` | optional | Host port for direct dashboard access (default: `8090`) |
| `RETENTION_DAYS` | optional | Days of traffic data to keep (default: `90`) |
| `GEO_REFRESH_DAYS` | optional | How often to refresh geo-block CIDR lists from ipdeny.com (default: `7`) |
| `TZ` | optional | Timezone for fail2ban logs (default: `UTC`) |
| `APP_URL` | optional* | Public URL of the dashboard (e.g. `https://dash.yourdomain.com`). Required for forgot-password emails. |
| `SMTP_HOST` | optional* | SMTP server hostname. Required for forgot-password emails. |
| `SMTP_PORT` | optional | SMTP port — `587` for STARTTLS (default), `465` for SSL |
| `SMTP_USER` | optional | SMTP username / login |
| `SMTP_PASSWORD` | optional | SMTP password |
| `SMTP_FROM` | optional | From address in reset emails (defaults to `SMTP_USER`) |
| `RESET_EXP` | optional | Self-service reset link expiry in seconds (default: `3600` = 1 h) |

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

#### Proxy host setup for the dashboard

Add a proxy host to expose the dashboard through the WAF:

1. **Hosts → Proxy Hosts → Add Proxy Host**
2. Set your domain name (e.g. `dash.yourdomain.com`)
3. Forward hostname: `npm_waf`, port: `8080` ← **routes through WAF**
4. Enable **SSL** and request a Let's Encrypt certificate

> **Note:** Point to `npm_waf:8080`, **not** to `npm_dashboard_frontend:80`. Traffic flows NPM → WAF → breach-detector → frontend. The WAF enforces OWASP ModSecurity rules on every request.

For direct LAN access that bypasses the WAF, the frontend is also available on `http://<host>:DASHBOARD_PORT` (default 8090).

The parser and fail2ban watch NPM's access logs automatically — traffic data appears in the dashboard within minutes of your first proxy host receiving requests.

### Dashboard

Open `http://your-server-ip:8090` (or your proxied domain over HTTPS)

On first visit with no users in the system, the login page shows an **admin creation form**:

1. Enter your name, email address, and a password (8+ chars recommended)
2. You will be redirected to MFA setup — scan the QR code with Google Authenticator, Authy, or 1Password
3. Enter the 6-digit code to confirm setup
4. You now have full access

On subsequent logins, sign in with your **email address** (or legacy username for accounts created before this change) and password.

---

## Dashboard overview

| Tab | What it shows |
|-----|--------------|
| **Overview** | Live request feed, traffic over time, HTTP status code breakdown, top hosts |
| **Traffic** | Per-host and per-path request/bandwidth charts, response latency (p50/p95/p99), slow request log, error rate delta vs previous period, configurable time period |
| **Visitors** | Top IPs with ISP/org lookup and 2-click ban, referrers, peak hours heatmap |
| **Geo** | Requests and unique visitors by country |
| **Tech** | Browser, OS, and device type breakdown |
| **Security** | Fail2ban jail status, banned IPs with one-click unban, manual IP block, geo-block by country, IP reputation (AbuseIPDB), WAF events, breach detection alerts, live fail2ban log feed |
| **Host** | CPU usage and load averages, memory and swap, network interfaces, temperatures, top processes, SSL certificate expiry per proxy host |

### Feature highlights

**Stat cards with delta indicators** — every summary card (total requests, bandwidth, errors, bots) shows a `↑`/`↓` percentage vs the previous equivalent period (e.g. today vs yesterday, this week vs last week).

**Response latency by host** — the Traffic tab shows a latency table with p50, p95, p99, and average per proxy host, color-coded green/amber/red by response time.

**Slow request log** — captures any request ≥ 2 s with host, path, method, status, and response time.

**Top IPs with owner lookup** — Visitors tab shows ISP/org for each source IP (resolved via [ipwho.is](https://ipwho.is)). Click **Ban** → **Confirm** to add a permanent fail2ban block in two clicks.

**SSL certificate expiry** — Host tab shows days remaining on each proxy host's certificate, color-coded: green (>30d), amber (≤30d), red (≤7d).

**Peak traffic heatmap** — shows request volume by hour and day of week. Cells are always visible even when empty.

**Geo-block CIDR auto-refresh** — blocked country CIDR lists (sourced from ipdeny.com) refresh automatically every `GEO_REFRESH_DAYS` days. The GeoBlock panel shows the last-refreshed date and a manual **↻ Refresh CIDRs** button. Refreshes are diff-based — only changed CIDRs are added or removed, avoiding any ban gap.

**WAF events** — Security tab shows ModSecurity audit log entries including rule ID, matched payload, and source IP. Events are geo-tagged and paged.

**Breach detection** — the breach-detector proxy watches for WAF bypass attempts and surfaces alerts in the Security tab.

**Dark/light theme** — toggle in the header. Preference is saved in browser localStorage.

**CSV export** — traffic data, WAF events, and breach events can each be exported as CSV from their respective tabs.

**Timezone selector** — the dropdown in the header applies to all charts, heatmaps, and timestamps. Defaults to US Pacific. Selection is saved in browser localStorage.

**Time period selector** — all traffic charts support: `24h · 3d · 7d · 30d · 90d · 180d · 360d`. Historical data is backfilled from NPM logs on first run.

---

## Authentication and user management

All dashboard routes require login. The auth service enforces:

- **bcrypt** password hashing
- **TOTP MFA** (6-digit codes, compatible with any authenticator app)
- **JWT session cookies** — 8-hour expiry, `httpOnly`, `SameSite=Strict`, `Secure`
- **Rate limiting** — nginx limits login attempts to 10/minute; API requests are limited to 10 req/s (600/min) with burst=60

### Managing users

Admins see a **👥 Users** button in the dashboard header. From there you can:

- **Invite a user** — enter the new user's full name and email address, choose admin or not, click **🔗 Generate Invite Link**. A one-time link is generated (valid 48 hours). Copy it and send it to the new user. When they open it they set their own password and are immediately taken through MFA setup — the admin never sees their password. Pending invites are listed with a Revoke button until accepted.
- **Send a reset link** — click **Reset** on any existing user row to generate a reset link. The user follows it to set a new password and re-enroll MFA. The admin never sets or knows the password at any point.
- **Delete a user** — permanent, requires confirmation. Any pending invite or reset link for that user is also revoked.

#### Invite flow

1. Admin enters name + email, clicks **🔗 Generate Invite Link**, copies the URL and sends it to the user
2. User opens the link → greeted by name, sees their email address shown as their sign-in identity
3. **Step 1** — user sets their own password
4. **Step 2** — MFA setup: scan QR code in authenticator app, enter 6-digit code to confirm
5. Full session granted — user lands on the dashboard
6. The invite token is single-use; expired or already-used links show a clear error page

#### Reset flow

Same two-step process as invite: user sets a new password, then re-enrolls a fresh MFA entry. The old MFA entry is invalidated immediately when the reset link is generated.

The invite/reset link expiry defaults to 48 hours. Override with `INVITE_EXP` (seconds) in `.env` if needed.

### Login credentials

- **Email address** is the login identifier for all accounts created via invite
- Legacy accounts (created before the invite system) can still log in with their original username
- The login field accepts both — email is tried first, username as fallback

### Forgot password

If `SMTP_HOST` and `APP_URL` are set in `.env`, a **Forgot password?** link appears on the login page. The user enters their email address and receives a reset link (valid 1 hour by default). The link leads through the same two-step flow as an admin-generated reset: set new password → re-enroll MFA.

The response always says "check your email" regardless of whether the address is registered — this prevents account enumeration.

**SMTP setup example (Gmail app password):**
```env
APP_URL=https://dash.yourdomain.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=you@gmail.com
```

After adding SMTP vars, restart the auth container:
```bash
docker compose up -d auth
```

### Signing out

Click your name in the header → **Sign out**. The session cookie is cleared.

---

## Security

### WAF (ModSecurity + OWASP CRS)

The `waf` service runs nginx with OWASP ModSecurity Core Rule Set (CRS) at Paranoia Level 2. It sits between NPM and the dashboard frontend.

| Setting | Default | Description |
|---------|---------|-------------|
| `WAF_MODE` | `DetectionOnly` | Set to `On` to actively block rule matches |
| `PARANOIA` | `2` | CRS paranoia level (1–4). Level 2 enables broader RFI, CRLF, and RCE rules |
| `WHITELIST_CIDRS` | _(empty)_ | CIDRs that bypass WAF rule enforcement (e.g. trusted LAN) |

**Switching WAF to blocking mode:**

```bash
# In .env:
WAF_MODE=On

docker compose up -d waf
```

WAF audit logs are written to a persistent volume, rotated by the `log-rotator` service, and streamed to the dashboard WAF events panel via `waf-api`.

**Custom rules** live in `waf-config/REQUEST-999-CUSTOM.conf` — add site-specific allow/deny rules here. They are loaded automatically by the CRS wildcard include.

### Breach detector

The `breach-detector` transparent proxy sits between the WAF and frontend. It flags requests where:
- The WAF fired a rule but passed the request (detection-only mode)
- Payload patterns match known bypass techniques

Alerts appear on the Security tab's **Breach Alerts** panel.

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

### 2-click ban from Top IPs

On the **Visitors** tab, every row in the Top IPs table shows the resolved ISP/org. To ban:
1. Click **Ban** → button turns into a **Confirm** prompt
2. Click **Confirm** to issue the permanent fail2ban block

### Geo blocking

The Security tab includes a **Block Countries** panel:

- Enter any two-letter ISO country code or click a country already seen in traffic
- Banning fetches all CIDRs for that country from [ipdeny.com](https://www.ipdeny.com) and adds them to fail2ban
- CIDR lists refresh automatically every `GEO_REFRESH_DAYS` days (default 7)
- Refreshes are diff-based: only newly added or removed CIDRs are changed, so no ban gap occurs
- The panel shows the last-refreshed date and a manual **↻ Refresh CIDRs** button

### IP reputation (AbuseIPDB)

Set `ABUSEIPDB_KEY` in `.env` to enable reputation scoring. The API shows a confidence-of-abuse score (0–100) on each IP in the top-IPs list and the Security tab ban lists.

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

MaxMind releases updated databases twice a week. The `geoip_updater` service handles this automatically when running. To force an immediate update:

```bash
docker compose restart geoip_updater
docker compose restart parser
```

### Refreshing geo-block CIDR lists

Geo-block CIDR lists (ipdeny.com) refresh automatically every `GEO_REFRESH_DAYS` days. To trigger an immediate refresh from the dashboard: Security tab → Block Countries → **↻ Refresh CIDRs**.

To trigger via CLI:

```bash
curl -X POST http://localhost:8001/api/f2b/geo/refresh
```

### Switching WAF mode

```bash
# Edit .env: WAF_MODE=On  (or DetectionOnly)
docker compose up -d waf
```

No rebuild needed — `WAF_MODE` is passed as an environment variable.

### Running WAF tests

```bash
docker compose logs npm_waf_tester --tail 50
```

The `waf-tester` service continuously exercises the WAF rule set and reports pass/fail for each test scenario.

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
| Dashboard (direct, bypasses WAF) | 8090 | External (firewall to trusted IPs) |
| Traffic API | 8000 | Internal only |
| Fail2ban API | 8001 | Internal only |
| Sysmon API | 8002 | Internal only |
| Auth API | 8003 | Internal only |
| WAF API | 8004 | Internal only |
| WAF Tester API | 8005 | Internal only |
| WAF (ModSecurity nginx) | 8080 | Internal only |
| Breach Detector proxy | 8090 (internal) | Internal only |
| Postgres | 5432 | Internal only |

**Recommendation:** firewall port 81 (NPM admin) and the dashboard direct-access port to your trusted IP ranges. All production traffic should go through NPM → WAF on 80/443.

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

### No response latency data

Response latency comes from NPM's `$upstream_response_time` log field. This field is `-` for requests NPM serves directly (e.g. NPM admin UI itself). Latency data only appears for traffic routed through a proxy host that reaches an upstream backend.

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

### WAF events not appearing

```bash
docker logs npm_waf --tail 30
docker logs npm_waf_api --tail 30
```

Check that the WAF audit log volume is mounted and the log file exists:

```bash
docker exec npm_waf_api ls -lh /waf_logs/audit/
```

If the audit log is empty, no rule matches have occurred yet (or WAF is receiving no traffic). Confirm NPM is pointing to `npm_waf:8080`.

### WAF blocking legitimate traffic

Switch to detection-only mode temporarily:

```bash
# In .env: WAF_MODE=DetectionOnly
docker compose up -d waf
```

Review the audit log to identify which rules are firing (`waf-api` events on the Security tab). Add exceptions to `waf-config/REQUEST-999-CUSTOM.conf` and rebuild:

```bash
docker compose up -d --build waf
```

### No GeoIP country data

Run the updater and confirm it succeeds:

```bash
docker compose run --rm geoip_updater
docker compose restart parser
```

Requires `MAXMIND_LICENSE_KEY` in `.env`.

### Geo-block country shows no CIDRs

The CIDR lists come from ipdeny.com. Check connectivity from the fail2ban container:

```bash
docker exec npm_fail2ban_api wget -q -O- https://www.ipdeny.com/ipblocks/data/countries/us.zone | wc -l
```

If the command returns a number, ipdeny.com is reachable. If it hangs or fails, check the host's outbound HTTPS access.

### Locked out — MFA codes always rejected

TOTP is time-based. If the server clock has drifted by more than ~30 seconds, codes will never match.

Check and fix the clock:
```bash
timedatectl status
sudo timedatectl set-ntp true
sudo systemctl restart systemd-timesyncd
```

If the clock is fine but you're still locked out, reset your account from the server CLI — no login required:

```bash
docker exec npm_auth python3 /app/reset_user.py aja175 https://dash.yourdomain.com
```

Replace `aja175` with your username or email, and the URL with your dashboard address. The command prints a one-time reset link. Open it in your browser to set a new password and re-enroll MFA.

If you don't have a public URL yet, omit it and the command prints just the token — append it to `http://your-server-ip:8090/auth/invite/<token>` to access the reset page.

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

### IP owner showing blank or incorrect

IP owner/ISP data comes from [ipwho.is](https://ipwho.is) — a free HTTPS API, no key required. Data is cached for 1 hour per IP. If owner data is blank:

```bash
docker exec npm_dashboard_api curl -s https://ipwho.is/8.8.8.8
```

If this returns JSON with an `isp` field, the API is reachable. If blank ISP fields appear after a successful call, the IP may be a private/RFC1918 address, which is expected.
