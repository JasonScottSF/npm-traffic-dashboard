#!/bin/sh
set -e

REPO_DIR="/repo"
INTERVAL=${BACKUP_INTERVAL:-3600}

log() { echo "$(date -u '+%Y-%m-%d %H:%M UTC') [backup] $*"; }

setup_git() {
    cd "$REPO_DIR"
    git config user.email "aja175@gmail.com"
    git config user.name "JasonScottSF"
    git remote set-url origin "https://JasonScottSF:${BACKUP_GITHUB_TOKEN}@github.com/JasonScottSF/Proxy.git"
    git pull --rebase origin main 2>/dev/null || true
}

run_backup() {
    log "Starting backup..."

    # Postgres dump
    log "Dumping database..."
    pg_dump "$DATABASE_URL" | gzip > "$REPO_DIR/db.sql.gz"

    # Volume tars
    log "Archiving volumes..."
    tar czf "$REPO_DIR/npm_data.tar.gz"      -C /volumes/npm_data      .
    tar czf "$REPO_DIR/auth_data.tar.gz"     -C /volumes/auth_data     .
    tar czf "$REPO_DIR/fail2ban_data.tar.gz" -C /volumes/fail2ban_data .

    # .env
    cp /config/.env "$REPO_DIR/.env"

    # Commit and push
    cd "$REPO_DIR"
    git add -A
    if git diff --cached --quiet; then
        log "No changes since last backup — skipping commit."
        return
    fi
    git commit -m "backup: $(date -u '+%Y-%m-%d %H:%M UTC')"
    git push origin main
    log "Backup pushed to git."
}

# Clone or pull the backup repo
if [ ! -d "$REPO_DIR/.git" ]; then
    log "Cloning backup repo..."
    git clone "https://JasonScottSF:${BACKUP_GITHUB_TOKEN}@github.com/JasonScottSF/Proxy.git" "$REPO_DIR"
fi

setup_git

# Run immediately on start, then on schedule
while true; do
    run_backup || log "Backup failed — will retry next cycle."
    log "Next backup in ${INTERVAL}s."
    sleep "$INTERVAL"
done
