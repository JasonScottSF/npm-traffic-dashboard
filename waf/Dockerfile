# syntax=docker/dockerfile:1
FROM owasp/modsecurity-crs:nginx-alpine

# The base image runs as 'nginx'; switch to root for build-time patches.
USER root
RUN apk add --no-cache curl

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

# Replace default server template: specific server_name blocks in the dynamic
# conf.d/dynamic/ directory take priority; unknown hosts get connection dropped.
COPY default.conf.template /etc/nginx/templates/conf.d/default.conf.template

# Add an include for dynamically-generated per-host configs.
# modsecurity is already ON globally via conf.d/modsecurity.conf, so the
# generated server blocks only need proxy_pass directives.
RUN printf 'include /etc/nginx/conf.d/dynamic/*.conf;\n' \
        > /etc/nginx/conf.d/dynamic_hosts.conf && \
    mkdir -p /etc/nginx/conf.d/dynamic
