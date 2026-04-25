#!/bin/sh
set -e

SETNAME="threat-blocklist"
SAFESET="${SETNAME}-safe"
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

    # Build a whitelist set from WHITELIST_CIDRS (comma or space separated)
    ipset destroy "$SAFESET" 2>/dev/null || true
    ipset create "$SAFESET" hash:net hashsize 256 maxelem 4096
    # Always protect RFC1918 private ranges
    for SAFE in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.0/8; do
        ipset add "$SAFESET" "$SAFE" 2>/dev/null || true
    done
    # Add any user-defined safe IPs/CIDRs from the env var
    if [ -n "$WHITELIST_CIDRS" ]; then
        echo "$WHITELIST_CIDRS" | tr ',' '\n' | tr ' ' '\n' | while read -r SAFE; do
            [ -z "$SAFE" ] && continue
            echo "[blocklist] Whitelisting $SAFE"
            ipset add "$SAFESET" "$SAFE" 2>/dev/null || true
        done
    fi

    # Prepare a fresh temporary block set
    ipset destroy "$TMPSET" 2>/dev/null || true
    ipset create "$TMPSET" hash:net hashsize 32768 maxelem 262144

    for URL in $SOURCES; do
        echo "[blocklist] Fetching $URL"
        curl -sf --max-time 30 "$URL" | grep -v '^\s*[#;]' | grep -v '^\s*$' | \
            awk '{print $1}' | while read -r ENTRY; do
                # Skip entries covered by the whitelist
                ipset test "$SAFESET" "$ENTRY" 2>/dev/null && continue || true
                ipset add "$TMPSET" "$ENTRY" 2>/dev/null || true
            done
    done

    # Atomically swap in the new set
    ipset create "$SETNAME" hash:net hashsize 32768 maxelem 262144 2>/dev/null || true
    ipset swap "$TMPSET" "$SETNAME"
    ipset destroy "$TMPSET" 2>/dev/null || true

    # Ensure DROP rules exist (idempotent); whitelist set takes precedence via RETURN rules
    iptables -C INPUT  -m set --match-set "$SAFESET" src -j RETURN 2>/dev/null || \
        iptables -I INPUT  -m set --match-set "$SAFESET" src -j RETURN
    iptables -C FORWARD -m set --match-set "$SAFESET" src -j RETURN 2>/dev/null || \
        iptables -I FORWARD -m set --match-set "$SAFESET" src -j RETURN
    iptables -C INPUT  -m set --match-set "$SETNAME" src -j DROP 2>/dev/null || \
        iptables -A INPUT  -m set --match-set "$SETNAME" src -j DROP
    iptables -C FORWARD -m set --match-set "$SETNAME" src -j DROP 2>/dev/null || \
        iptables -A FORWARD -m set --match-set "$SETNAME" src -j DROP

    TOTAL=$(ipset list "$SETNAME" | grep -c "^[0-9a-f]" 2>/dev/null || echo "?")
    echo "[blocklist] Done. $TOTAL entries active. RFC1918 + WHITELIST_CIDRS are always safe."
}

apply

while true; do
    sleep $((INTERVAL * 3600))
    apply
done
