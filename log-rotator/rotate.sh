#!/bin/sh
# Run logrotate once at startup, then every 6 hours.
# logrotate itself enforces daily/weekly cadence via its own state file.
LOGROTATE_STATE=/waf_logs/logrotate.state
mkdir -p /waf_logs/audit

while true; do
    logrotate -s "$LOGROTATE_STATE" /etc/logrotate.d/waf-audit
    sleep 21600   # 6 hours
done
