# syntax=docker/dockerfile:1
FROM owasp/modsecurity-crs:nginx-alpine

# The entrypoint's 90-copy-modsecurity-config.sh tries to copy the
# envsubst-rendered override into /etc/modsecurity.d/ but fails because
# the destination is in a read-only image layer.  Replace the static file
# with a symlink to the nginx template output path so the 20-envsubst step
# writes SecRuleEngine directly to where nginx loads it from.
RUN rm /etc/modsecurity.d/modsecurity-override.conf \
    && ln -s /etc/nginx/modsecurity.d/modsecurity-override.conf \
             /etc/modsecurity.d/modsecurity-override.conf

# Whitelist entrypoint — runs at 05- (before template rendering at 20-).
COPY --chmod=755 05-whitelist.sh /docker-entrypoint.d/05-whitelist.sh
