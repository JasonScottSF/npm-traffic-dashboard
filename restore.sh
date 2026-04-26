#!/usr/bin/env bash
# restore.sh — Recover the full stack from the latest git backup
# Usage: curl -fsSL https://raw.githubusercontent.com/JasonScottSF/npm-traffic-dashboard/main/restore.sh | sudo bash
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[restore]${NC} $*"; }
success() { echo -e "${GREEN}[restore]${NC} $*"; }
warn()    { echo -e "${YELLOW}[restore]${NC} $*"; }
die()     { echo -e "${RED}[restore] ERROR:${NC} $*" >&2; exit 1; }

[ "$EUID" -eq 0 ] || die "Run as root: sudo bash restore.sh"

# ── Collect inputs ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  NPM Traffic Dashboard — Disaster Recovery${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

read -rsp "  GitHub token for backup repo (JasonScottSF/Proxy): " BACKUP_TOKEN; echo
[ -n "$BACKUP_TOKEN" ] || die "Token required."

INSTALL_DIR="${INSTALL_DIR:-/opt/npm-dashboard}"

# ── Docker ────────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    info "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    success "Docker installed."
else
    success "Docker already installed."
fi

# ── Clone repos ───────────────────────────────────────────────────────────────
info "Cloning main repo..."
if [ -d "$INSTALL_DIR" ]; then
    cd "$INSTALL_DIR" && git pull --rebase
else
    git clone https://github.com/JasonScottSF/npm-traffic-dashboard.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi
git checkout feature/npm-stack   # TODO: update to main after PR merges

info "Cloning backup repo..."
BACKUP_DIR=$(mktemp -d)
git clone "https://JasonScottSF:${BACKUP_TOKEN}@github.com/JasonScottSF/Proxy.git" "$BACKUP_DIR"

# Optionally restore from a specific commit
if [ -n "${RESTORE_COMMIT:-}" ]; then
    info "Checking out commit $RESTORE_COMMIT..."
    git -C "$BACKUP_DIR" checkout "$RESTORE_COMMIT"
fi

# ── Restore .env ──────────────────────────────────────────────────────────────
info "Restoring .env..."
cp "$BACKUP_DIR/.env" "$INSTALL_DIR/.env"

# ── Start postgres only ───────────────────────────────────────────────────────
info "Starting database..."
cd "$INSTALL_DIR"
docker compose up -d db
info "Waiting for postgres to be ready..."
until docker compose exec -T db pg_isready -U dashboard -q; do sleep 2; done

# ── Restore database ──────────────────────────────────────────────────────────
info "Restoring database..."
gunzip -c "$BACKUP_DIR/db.sql.gz" | docker compose exec -T db psql -U dashboard -d npm_dashboard
success "Database restored."

# ── Restore volumes ───────────────────────────────────────────────────────────
restore_volume() {
    local name="$1" file="$2"
    if [ -f "$BACKUP_DIR/$file" ]; then
        info "Restoring $name..."
        docker volume create "$name" 2>/dev/null || true
        docker run --rm \
            -v "${name}:/data" \
            -v "${BACKUP_DIR}:/backup:ro" \
            alpine sh -c "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar xzf /backup/${file} -C /data"
        success "$name restored."
    else
        warn "$file not found in backup — skipping $name."
    fi
}

restore_volume "npm-traffic-dashboard_npm_data"      "npm_data.tar.gz"
restore_volume "npm-traffic-dashboard_auth_data"     "auth_data.tar.gz"
restore_volume "npm-traffic-dashboard_fail2ban_data" "fail2ban_data.tar.gz"

# ── Start full stack ──────────────────────────────────────────────────────────
info "Starting full stack..."
docker compose up -d

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -rf "$BACKUP_DIR"

# ── Summary ───────────────────────────────────────────────────────────────────
HOST_IP=$(hostname -I | awk '{print $1}')
DPORT=$(grep "^DASHBOARD_PORT=" "$INSTALL_DIR/.env" | cut -d= -f2 || echo 8090)

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Restore complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  NPM admin:  ${CYAN}http://${HOST_IP}:81${NC}"
echo -e "  Dashboard:  ${CYAN}http://${HOST_IP}:${DPORT}${NC}"
echo ""
echo -e "  To restore from a specific backup point:"
echo -e "  ${YELLOW}RESTORE_COMMIT=abc1234 bash restore.sh${NC}"
echo ""
