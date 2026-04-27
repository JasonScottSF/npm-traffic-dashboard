FROM alpine:3.19
RUN apk add --no-cache logrotate
COPY logrotate.conf /etc/logrotate.d/waf-audit
COPY rotate.sh /rotate.sh
RUN chmod +x /rotate.sh
CMD ["/rotate.sh"]
