#!/bin/sh
set -e

REPO_DIR="/repo"
INTERVAL=${BACKUP_INTERVAL:-3600}
TRIGGER_FILE="/trigger/run_now"

log() { echo "$(date -u '+%Y-%m-%d %H:%M UTC') [backup] $*"; }

# Write a status record to PostgreSQL so the dashboard can show backup health.
# Called as: record_status STATUS MESSAGE [COMMIT_SHA] [DURATION_S]
record_status() {
    STATUS="$1"
    MESSAGE="$2"
    SHA="${3:-}"
    DUR="${4:-0}"
    # Ensure the table exists (idempotent — safe to call every run)
    psql "$DATABASE_URL" -c "
        CREATE TABLE IF NOT EXISTS backup_status (
            id          BIGSERIAL PRIMARY KEY,
            ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            status      TEXT NOT NULL,
            message     TEXT,
            commit_sha  TEXT,
            duration_s  INT
        )
    " 2>/dev/null || true
    psql "$DATABASE_URL" -c "
        INSERT INTO backup_status (status, message, commit_sha, duration_s)
        VALUES ('${STATUS}', '${MESSAGE}', '${SHA}', ${DUR})
    " 2>/dev/null || true
}

setup_git() {
    cd "$REPO_DIR"
    git config user.email "aja175@gmail.com"
    git config user.name "JasonScottSF"
    git remote set-url origin "https://JasonScottSF:${BACKUP_GITHUB_TOKEN}@github.com/JasonScottSF/Proxy.git"
    git pull --rebase origin main 2>/dev/null || true
}

run_backup() {
    log "Starting backup..."
    START=$(date +%s)

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
        END=$(date +%s)
        record_status "no_changes" "No changes since last backup" "" "$((END - START))"
        return
    fi
    git commit -m "backup: $(date -u '+%Y-%m-%d %H:%M UTC')"
    SHA=$(git rev-parse --short HEAD)
    git push origin main
    END=$(date +%s)
    log "Backup pushed to git (${SHA})."
    record_status "success" "Backup pushed to GitHub" "$SHA" "$((END - START))"
}

# Clone or pull the backup repo
if [ ! -d "$REPO_DIR/.git" ]; then
    log "Cloning backup repo..."
    git clone "https://JasonScottSF:${BACKUP_GITHUB_TOKEN}@github.com/JasonScottSF/Proxy.git" "$REPO_DIR"
fi

setup_git

# Sleep in 5s increments so the trigger file is picked up quickly
wait_or_trigger() {
    local remaining=$INTERVAL
    while [ "$remaining" -gt 0 ]; do
        if [ -f "$TRIGGER_FILE" ]; then
            rm -f "$TRIGGER_FILE"
            log "Manual trigger detected — running backup now."
            return
        fi
        sleep 5
        remaining=$((remaining - 5))
    done
}

# Run immediately on start, then on schedule
while true; do
    run_backup || {
        log "Backup failed — will retry next cycle."
        record_status "failed" "Backup script exited with an error" "" "0"
    }
    log "Next backup in ${INTERVAL}s."
    wait_or_trigger
done
