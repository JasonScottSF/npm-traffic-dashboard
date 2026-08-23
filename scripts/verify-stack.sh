#!/usr/bin/env bash
# verify-stack.sh — prove the stack is actually protecting you.
#
# WHY THIS EXISTS
# ---------------
# Every component here fails QUIETLY and in the insecure direction:
#
#   * fail2ban that cannot write a rule looks identical to one that works.
#     Jails show "active", counters increment, and nothing is ever blocked.
#   * a proxy host pointed at the frontend instead of the WAF still serves
#     the site perfectly - it just skips inspection.
#   * a container stuck "unhealthy" keeps its published port open.
#
# In all three cases the site stays up, so nobody notices. This script tries
# the things that matter instead of assuming them, and it is safe to run
# repeatedly on a live system - the ban test uses a TEST-NET address from
# RFC 5737 and removes it afterwards.
#
# Usage:  ./scripts/verify-stack.sh          from the repo root
set -uo pipefail

G=$'\e[32m'; R=$'\e[31m'; Y=$'\e[33m'; C=$'\e[36m'; N=$'\e[0m'
PASS=0; FAIL=0; SKIP=0
ok()   { echo "  ${G}PASS${N}  $*"; PASS=$((PASS+1)); }
bad()  { echo "  ${R}FAIL${N}  $*"; FAIL=$((FAIL+1)); }
skip() { echo "  ${Y}SKIP${N}  $*"; SKIP=$((SKIP+1)); }

cd "$(dirname "$0")/.." || exit 1
DC="docker compose"
$DC version >/dev/null 2>&1 || { echo "docker compose not available"; exit 2; }

DASHBOARD_PORT=$(grep -E '^DASHBOARD_PORT=' .env 2>/dev/null | cut -d= -f2)
DASHBOARD_PORT=${DASHBOARD_PORT:-8090}

echo ""
echo "${C}1. Containers${N}"
EXPECTED=$($DC config --services 2>/dev/null | wc -l | tr -d ' ')
RUNNING=$($DC ps --status running --quiet 2>/dev/null | wc -l | tr -d ' ')
[ "$RUNNING" -gt 0 ] && ok "$RUNNING of $EXPECTED services running" \
                     || bad "nothing is running - try: docker compose up -d"

UNHEALTHY=$($DC ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep -i unhealthy || true)
if [ -n "$UNHEALTHY" ]; then
    bad "unhealthy containers (their ports are still open):"
    echo "$UNHEALTHY" | sed 's/^/          /'
else
    ok "no unhealthy containers"
fi

RESTARTING=$($DC ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep -i restarting || true)
[ -z "$RESTARTING" ] && ok "nothing stuck in a restart loop" \
  || { bad "restart loop:"; echo "$RESTARTING" | sed 's/^/          /'; }

echo ""
echo "${C}2. Reachability${N}"
probe() {  # probe <name> <url> <accept-codes-regex>
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$2" 2>/dev/null)
    if [[ "$code" =~ $3 ]]; then ok "$1 responded ($code)"
    elif [ "$code" = "000" ]; then bad "$1 did not answer at $2"
    else bad "$1 returned $code at $2"; fi
}
probe "dashboard"  "http://127.0.0.1:${DASHBOARD_PORT}/"  '^(200|301|302|401|403)$'
probe "NPM admin"  "http://127.0.0.1:81/"                 '^(200|301|302|401)$'

echo ""
echo "${C}3. fail2ban can actually ban${N}"
# The whole point. A jail that is "active" proves nothing; only a rule
# appearing in the kernel does.
if ! $DC ps --status running --quiet fail2ban-server >/dev/null 2>&1 \
   || [ -z "$($DC ps --status running --quiet fail2ban-server 2>/dev/null)" ]; then
    bad "fail2ban-server is not running - NOTHING is being blocked"
else
    TESTIP="198.51.100.42"   # RFC 5737 TEST-NET-2. Never routable.
    JAIL=$($DC exec -T fail2ban-server fail2ban-client status 2>/dev/null \
           | sed -n 's/.*Jail list:[[:space:]]*//p' | cut -d, -f1 | tr -d ' \r')
    if [ -z "$JAIL" ]; then
        bad "fail2ban has no jails loaded - check fail2ban-config/jail.local"
    else
        $DC exec -T fail2ban-server fail2ban-client set "$JAIL" banip "$TESTIP" >/dev/null 2>&1
        sleep 1
        if $DC exec -T fail2ban-server iptables -S DOCKER-USER 2>/dev/null | grep -q "$TESTIP"; then
            ok "ban reached the DOCKER-USER chain (jail: $JAIL)"
        elif $DC exec -T fail2ban-server iptables -S 2>/dev/null | grep -q "$TESTIP"; then
            bad "ban landed OUTSIDE DOCKER-USER - Docker's NAT path bypasses it, so container traffic is NOT blocked"
        else
            bad "fail2ban accepted the ban but no kernel rule appeared - it is banning nothing"
        fi
        $DC exec -T fail2ban-server fail2ban-client set "$JAIL" unbanip "$TESTIP" >/dev/null 2>&1
    fi
fi

echo ""
echo "${C}4. WAF is in the path${N}"
if [ -z "$($DC ps --status running --quiet waf 2>/dev/null)" ]; then
    bad "the WAF container is not running"
else
    ok "WAF container is running"
    # A proxy host pointed straight at the frontend serves the site fine and
    # skips inspection entirely, so this is worth stating rather than assuming.
    echo "        ${Y}note${N}  in NPM, proxy hosts must forward to ${C}npm_waf:8080${N},"
    echo "              NOT to the frontend directly, or the WAF is bypassed."
fi

echo ""
echo "─────────────────────────────────────────────"
echo "  ${G}$PASS passed${N}   ${R}$FAIL failed${N}   ${Y}$SKIP skipped${N}"
[ "$FAIL" -eq 0 ] && echo "  Stack looks healthy." || echo "  ${R}Fix the failures above before exposing this to the internet.${N}"
echo ""
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
