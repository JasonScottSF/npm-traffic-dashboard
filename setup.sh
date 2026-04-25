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
    apt-get update -qq && apt-get install -y -qq docker-compose-plugin
    success "Docker Compose installed."
else
    success "Docker Compose already available: $(docker compose version --short)"
fi

# ── 4. .env setup ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f .env ]; then
    warn ".env already exists — skipping creation. Edit it manually if needed."
else
    cp .env.example .env

    echo ""
    info "Let's configure your .env file."
    echo ""

    # DB_PASSWORD
    while true; do
        read -rsp "  Postgres password (min 12 chars): " DB_PASS; echo
        [ ${#DB_PASS} -ge 12 ] && break
        warn "  Password must be at least 12 characters."
    done
    sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASS}|" .env

    # APP_NAME
    read -rp "  Dashboard name [NPM Dashboard]: " APP_NAME
    APP_NAME="${APP_NAME:-NPM Dashboard}"
    sed -i "s|^APP_NAME=.*|APP_NAME=${APP_NAME}|" .env

    # DASHBOARD_PORT
    read -rp "  Direct-access port for dashboard [8090]: " DPORT
    DPORT="${DPORT:-8090}"
    sed -i "s|^DASHBOARD_PORT=.*|DASHBOARD_PORT=${DPORT}|" .env

    # TZ
    read -rp "  Timezone [America/Los_Angeles]: " TZ_VAL
    TZ_VAL="${TZ_VAL:-America/Los_Angeles}"
    sed -i "s|^TZ=.*|TZ=${TZ_VAL}|" .env

    # MaxMind
    read -rp "  MaxMind license key (optional, press Enter to skip): " MM_KEY
    if [ -n "$MM_KEY" ]; then
        sed -i "s|^MAXMIND_LICENSE_KEY=.*|MAXMIND_LICENSE_KEY=${MM_KEY}|" .env
    fi

    success ".env created."
fi

# ── 5. Pull images & start ────────────────────────────────────────────────────
echo ""
info "Building and starting the stack..."
docker compose pull --quiet 2>/dev/null || true
docker compose up -d --build

echo ""
success "Stack is up."

# ── 6. GeoIP seed ─────────────────────────────────────────────────────────────
if grep -q "MAXMIND_LICENSE_KEY=.\+" .env 2>/dev/null; then
    info "Running initial GeoIP download..."
    docker compose run --rm geoip_updater
fi

# ── 7. Summary ────────────────────────────────────────────────────────────────
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
echo -e "  In NPM, add a proxy host pointing to:"
echo -e "    ${CYAN}http://npm_dashboard_frontend:80${NC}"
echo ""
