import os
import time
import logging
import boto3
import requests
from botocore.exceptions import ClientError

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ddns] %(message)s")
log = logging.getLogger()

NPM_URL      = os.environ["NPM_URL"].rstrip("/")
NPM_EMAIL    = os.environ["NPM_EMAIL"]
NPM_PASSWORD = os.environ["NPM_PASSWORD"]
ZONE_ID      = os.environ["DDNS_HOSTED_ZONE_ID"]
TTL          = int(os.environ.get("DDNS_TTL", "60"))
INTERVAL     = int(os.environ.get("DDNS_INTERVAL", "300"))

r53 = boto3.client("route53")

# ── NPM auth ──────────────────────────────────────────────────────────────────

_token = None

def npm_token():
    global _token
    resp = requests.post(
        f"{NPM_URL}/api/tokens",
        json={"identity": NPM_EMAIL, "secret": NPM_PASSWORD},
        timeout=10,
    )
    resp.raise_for_status()
    _token = resp.json()["token"]
    return _token

def npm_get(path):
    global _token
    if _token is None:
        npm_token()
    r = requests.get(f"{NPM_URL}{path}", headers={"Authorization": f"Bearer {_token}"}, timeout=10)
    if r.status_code == 401:
        npm_token()
        r = requests.get(f"{NPM_URL}{path}", headers={"Authorization": f"Bearer {_token}"}, timeout=10)
    r.raise_for_status()
    return r.json()

# ── Discovery ─────────────────────────────────────────────────────────────────

def get_npm_domains():
    hosts = npm_get("/api/nginx/proxy-hosts")
    domains = []
    for host in hosts:
        for name in host.get("domain_names", []):
            if name and "*" not in name:
                domains.append(name.lower())
    return sorted(set(domains))

def get_external_ip():
    for url in ("https://checkip.amazonaws.com", "https://api.ipify.org", "https://ifconfig.me/ip"):
        try:
            r = requests.get(url, timeout=10)
            r.raise_for_status()
            return r.text.strip()
        except Exception:
            continue
    raise RuntimeError("Could not determine external IP from any source")

# ── Route53 ───────────────────────────────────────────────────────────────────

def current_r53_ip(fqdn):
    try:
        resp = r53.list_resource_record_sets(
            HostedZoneId=ZONE_ID,
            StartRecordName=fqdn,
            StartRecordType="A",
            MaxItems="1",
        )
        for rrs in resp.get("ResourceRecordSets", []):
            if rrs["Name"].rstrip(".") == fqdn.rstrip(".") and rrs["Type"] == "A":
                return rrs["ResourceRecords"][0]["Value"]
    except ClientError:
        pass
    return None

def upsert_record(fqdn, ip):
    r53.change_resource_record_sets(
        HostedZoneId=ZONE_ID,
        ChangeBatch={
            "Comment": "ddns auto-update",
            "Changes": [{
                "Action": "UPSERT",
                "ResourceRecordSet": {
                    "Name": fqdn if fqdn.endswith(".") else fqdn + ".",
                    "Type": "A",
                    "TTL": TTL,
                    "ResourceRecords": [{"Value": ip}],
                },
            }],
        },
    )

# ── Main loop ─────────────────────────────────────────────────────────────────

def sync():
    ip = get_external_ip()
    log.info(f"External IP: {ip}")

    domains = get_npm_domains()
    if not domains:
        log.warning("No domains found in NPM — nothing to update")
        return

    log.info(f"Discovered {len(domains)} domain(s): {', '.join(domains)}")

    updated = skipped = failed = 0
    for domain in domains:
        try:
            current = current_r53_ip(domain)
            if current == ip:
                skipped += 1
                continue
            upsert_record(domain, ip)
            log.info(f"  Updated {domain}: {current or '(new)'} → {ip}")
            updated += 1
        except Exception as e:
            log.error(f"  Failed {domain}: {e}")
            failed += 1

    log.info(f"Done. updated={updated} skipped={skipped} failed={failed}")

def main():
    log.info(f"DDNS updater starting — zone={ZONE_ID} interval={INTERVAL}s ttl={TTL}s")
    while True:
        try:
            sync()
        except Exception as e:
            log.error(f"Sync error: {e}")
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
