#!/usr/bin/env bash
# setup.sh — Bootstrap NPM Traffic Dashboard on a fresh host
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[setup]${NC} $*"; }
success() { echo -e "${GREEN}[setup]${NC} $*"; }
warn()    { echo -e "${YELLOW}[setup]${NC} $*"; }
die()     { echo -e "${RED}[setup] ERROR:${NC} $*" >&2; exit 1; }

# ── 1. Root check ─────────────────────────────────────────────────────────────
[ "$EUID" -eq 0 ] || die "Run as root: sudo bash setup.sh"

# ── 2. Docker ─────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    info "Docker not found — installing via get.docker.com convenience script..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    success "Docker installed."
else
    success "Docker already installed: $(docker --version)"
fi

# Ensure the calling user (SUDO_USER) is in the docker group
if [ -n "${SUDO_USER:-}" ] && ! groups "$SUDO_USER" | grep -q docker; then
    usermod -aG docker "$SUDO_USER"
    warn "Added $SUDO_USER to the docker group. You may need to log out and back in for this to take effect."
fi

# ── 3. Docker Compose ─────────────────────────────────────────────────────────
if ! docker compose version &>/dev/null; then
    info "Docker Compose plugin not found — installing..."
    apt-get update -qq && apt-get install -y -qq docker-compose-plugin || true
    docker compose version &>/dev/null \
        || die "Docker Compose plugin still unavailable. On very new Ubuntu releases the
       get.docker.com repo may not carry this codename yet. Install docker-ce and
       docker-compose-plugin from the Docker apt repo (substituting the nearest
       supported codename), confirm 'docker compose version' works, then re-run."
    success "Docker Compose installed."
else
    success "Docker Compose already available: $(docker compose version --short)"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 4. Secrets ────────────────────────────────────────────────────────────────
# Passwords, tokens and API keys are Docker secrets (files in secrets/), NOT .env
# values. Every secret named in the compose file must exist as a file before the
# stack will start - Compose refuses to create a container whose secret file is
# missing. Optional secrets get an empty file so the service starts and degrades.
ALL_SECRETS=(db_password backup_github_token smtp_user smtp_password
             maxmind_license_key abuseipdb_key)

mkdir -p secrets
chmod 700 secrets

# write_secret <name> <prompt> <hidden|plain>
# Skips any file that already exists, empty ones included - an empty optional
# secret is a deliberate "not using this", and re-prompting for it would make
# re-running the script a chore. To add one later, write the file by hand:
#   printf '%s' 'the-key' > secrets/<name>.txt && chmod 600 secrets/<name>.txt
write_secret() {
    local name="$1" prompt="$2" mode="$3" value=""
    local path="secrets/${name}.txt"

    if [ -f "$path" ]; then
        if [ -s "$path" ]; then
            success "  secrets/${name}.txt already set - leaving it alone."
        else
            info "  secrets/${name}.txt present but empty - skipping (optional)."
        fi
        return
    fi

    # `|| true` so a non-interactive run (no tty, empty stdin) writes an empty
    # file and carries on rather than dying under `set -e`.
    if [ "$mode" = "hidden" ]; then
        read -rsp "  ${prompt}: " value || true; echo
    else
        read -rp "  ${prompt}: " value || true
    fi

    printf '%s' "$value" > "$path"
    chmod 600 "$path"
}

echo ""
info "Configuring secrets (written to secrets/, never to .env)."
echo ""

if [ -s secrets/db_password.txt ]; then
    success "  secrets/db_password.txt already set - leaving it alone."
else
    while true; do
        read -rsp "  Postgres password (min 12 chars): " DB_PASS \
            || die "No input available. Run setup.sh interactively, or create
       secrets/db_password.txt by hand before re-running."
        echo
        [ ${#DB_PASS} -ge 12 ] && break
        warn "  Password must be at least 12 characters."
    done
    printf '%s' "$DB_PASS" > secrets/db_password.txt
    chmod 600 secrets/db_password.txt
fi

write_secret backup_github_token "GitHub PAT for backups (optional, Enter to skip)"    hidden
write_secret smtp_user           "SMTP username / from address (optional, Enter to skip)" plain
write_secret smtp_password       "SMTP password (optional, Enter to skip)"             hidden
write_secret maxmind_license_key "MaxMind license key (optional, Enter to skip)"       plain
write_secret abuseipdb_key       "AbuseIPDB API key (optional, Enter to skip)"         plain

success "Secrets written to secrets/."

# ── 5. .env setup (non-secret configuration) ─────────────────────────────────
if [ -f .env ]; then
    warn ".env already exists - skipping creation. Edit it manually if needed."
else
    cp .env.example .env

    echo ""
    info "Let's configure your .env file."
    echo ""

    # APP_NAME
    read -rp "  Dashboard name [NPM Dashboard]: " APP_NAME || true
    APP_NAME="${APP_NAME:-NPM Dashboard}"
    sed -i "s|^APP_NAME=.*|APP_NAME=${APP_NAME}|" .env

    # DASHBOARD_PORT
    read -rp "  Direct-access port for dashboard [8090]: " DPORT || true
    DPORT="${DPORT:-8090}"
    sed -i "s|^DASHBOARD_PORT=.*|DASHBOARD_PORT=${DPORT}|" .env

    # TZ
    read -rp "  Timezone [America/Los_Angeles]: " TZ_VAL || true
    TZ_VAL="${TZ_VAL:-America/Los_Angeles}"
    sed -i "s|^TZ=.*|TZ=${TZ_VAL}|" .env

    success ".env created."
fi

# ── 6. Preflight ──────────────────────────────────────────────────────────────
# Fail loudly here rather than letting Compose fail halfway through a bring-up.
MISSING=()
for s in "${ALL_SECRETS[@]}"; do
    [ -f "secrets/${s}.txt" ] || MISSING+=("secrets/${s}.txt")
done
[ ${#MISSING[@]} -eq 0 ] || die "Missing secret files: ${MISSING[*]}"
[ -s secrets/db_password.txt ] || die "secrets/db_password.txt is empty - Postgres will not start."

docker compose config >/dev/null \
    || die "docker compose config failed - fix the errors above before continuing."

# ── 7. Pull images & start ────────────────────────────────────────────────────
echo ""
info "Building and starting the stack..."
docker compose pull --quiet 2>/dev/null || true
docker compose up -d --build

echo ""
success "Stack is up."

# ── 8. GeoIP seed ─────────────────────────────────────────────────────────────
if [ -s secrets/maxmind_license_key.txt ]; then
    info "Running initial GeoIP download..."
    docker compose run --rm geoip_updater
fi

# ── 9. Summary ────────────────────────────────────────────────────────────────
DPORT=$(grep "^DASHBOARD_PORT=" .env | cut -d= -f2)
DPORT="${DPORT:-8090}"
HOST_IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  NPM Traffic Dashboard is running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  NPM admin:  ${CYAN}http://${HOST_IP}:81${NC}"
echo -e "  Dashboard:  ${CYAN}http://${HOST_IP}:${DPORT}${NC}"
echo ""
echo -e "  ${YELLOW}NPM admin default login:${NC}"
echo -e "    Email:    admin@example.com"
echo -e "    Password: changeme"
echo -e "  ${YELLOW}Change these immediately after first login.${NC}"
echo ""
echo -e "  ${YELLOW}Dashboard first login:${NC}"
echo -e "    No users exist yet. The login page will prompt you"
echo -e "    to create an admin account and set up MFA."
echo ""
echo -e "  In NPM, add a proxy host with forward hostname/port:"
echo -e "    ${CYAN}npm_waf${NC} port ${CYAN}8080${NC}"
echo -e "  This routes NPM -> WAF -> breach-detector -> frontend."
echo -e "  ${YELLOW}Do NOT point it at npm_dashboard_frontend:80 - that bypasses the WAF.${NC}"
echo ""
