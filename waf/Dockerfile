FROM owasp/modsecurity-crs:nginx-alpine

# Inject our whitelist entrypoint script.
# Numbered 05- so it runs before the template rendering (20-) and
# config-copy (90-) steps, while the CRS rules dir is already in place.
COPY 05-whitelist.sh /docker-entrypoint.d/05-whitelist.sh
RUN chmod +x /docker-entrypoint.d/05-whitelist.sh
