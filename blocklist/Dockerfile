FROM alpine:3.19
RUN apk add --no-cache ipset iptables curl
COPY sync.sh /sync.sh
RUN chmod +x /sync.sh
CMD ["/sync.sh"]
