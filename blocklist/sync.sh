#!/bin/sh
set -e

SETNAME="threat-blocklist"
TMPSET="${SETNAME}-tmp"
INTERVAL=${REFRESH_HOURS:-24}

# Sources: Firehol level1 (aggregates ~20 feeds) + Spamhaus DROP/EDROP
SOURCES="
https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset
https://www.spamhaus.org/drop/drop.txt
https://www.spamhaus.org/drop/edrop.txt
"

apply() {
    echo "[blocklist] Refreshing threat IP blocklist..."

    # Prepare a fresh temporary set
    ipset destroy "$TMPSET" 2>/dev/null || true
    ipset create "$TMPSET" hash:net hashsize 32768 maxelem 262144

    COUNT=0
    for URL in $SOURCES; do
        echo "[blocklist] Fetching $URL"
        curl -sf --max-time 30 "$URL" | grep -v '^\s*[#;]' | grep -v '^\s*$' | \
            awk '{print $1}' | while read -r ENTRY; do
                ipset add "$TMPSET" "$ENTRY" 2>/dev/null || true
                COUNT=$((COUNT + 1))
            done
    done

    # Atomically swap in the new set
    ipset create "$SETNAME" hash:net hashsize 32768 maxelem 262144 2>/dev/null || true
    ipset swap "$TMPSET" "$SETNAME"
    ipset destroy "$TMPSET" 2>/dev/null || true

    # Ensure a single DROP rule exists (idempotent)
    iptables -C INPUT  -m set --match-set "$SETNAME" src -j DROP 2>/dev/null || \
        iptables -I INPUT  -m set --match-set "$SETNAME" src -j DROP
    iptables -C FORWARD -m set --match-set "$SETNAME" src -j DROP 2>/dev/null || \
        iptables -I FORWARD -m set --match-set "$SETNAME" src -j DROP

    TOTAL=$(ipset list "$SETNAME" | grep -c "^[0-9a-f]" 2>/dev/null || echo "?")
    echo "[blocklist] Done. $TOTAL entries active."
}

apply

# Refresh on schedule
while true; do
    sleep $((INTERVAL * 3600))
    apply
done
