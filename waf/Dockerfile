# syntax=docker/dockerfile:1
FROM owasp/modsecurity-crs:nginx-alpine

# The entrypoint's 90-copy step fails to write modsecurity-override.conf
# into /etc/modsecurity.d/, so MODSEC_RULE_ENGINE never reaches nginx.
# Fix: patch the setup.conf template so it includes the envsubst-generated
# file from /etc/nginx/modsecurity.d/ directly — that file IS correctly
# written by the 20-envsubst step with the right SecRuleEngine value.
RUN sed -i \
    's|Include /etc/modsecurity.d/modsecurity-override.conf|Include /etc/nginx/modsecurity.d/modsecurity-override.conf|g' \
    /etc/nginx/templates/modsecurity.d/setup.conf.template

# Whitelist entrypoint — runs at 05- (before template rendering at 20-).
COPY --chmod=755 05-whitelist.sh /docker-entrypoint.d/05-whitelist.sh
