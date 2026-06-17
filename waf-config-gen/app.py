"""
WAF Config Generator
====================
Polls the NPM API, discovers all enabled proxy hosts, saves their backends,
auto-redirects each proxy host through the WAF (npm_waf:8080) in NPM, and
generates per-host nginx server blocks in /waf_conf/ so the WAF routes
each domain to the correct upstream.

modsecurity is enabled globally in the WAF via conf.d/modsecurity.conf,
so generated server blocks only need proxy_pass — no modsec directives needed.

Environment variables
---------------------
NPM_API_URL           NPM admin API base URL (default: http://nginx_proxy_manager:81)
NPM_API_EMAIL         NPM admin email (required for auto-sync)
NPM_API_PASSWORD      NPM admin password (required for auto-sync)
WAF_AUTO_REDIRECT     If "true" (default), auto-update NPM to route hosts via WAF
WAF_STATIC_BACKENDS   Comma-separated domain=scheme://host:port pairs for hosts
                      already routing through the WAF (e.g. the dashboard).
                      Example: dash.example.com=http://breach-detector:8090
WAF_CONTAINER         Docker container name of the WAF (default: npm_waf)
WAF_PORT              Port the WAF listens on (default: 8080)
SYNC_INTERVAL         Seconds between sync cycles (default: 30)
"""
import asyncio
import hashlib
import json
import os
import re
import time
from pathlib import Path

import httpx

NPM_API_URL     = os.environ.get("NPM_API_URL",      "http://nginx_proxy_manager:81")
NPM_EMAIL       = os.environ.get("NPM_API_EMAIL",     "")
NPM_PASSWORD    = os.environ.get("NPM_API_PASSWORD",  "")
AUTO_REDIRECT   = os.environ.get("WAF_AUTO_REDIRECT", "true").lower() == "true"
STATIC_BACKENDS = os.environ.get("WAF_STATIC_BACKENDS", "")
WAF_CONTAINER   = os.environ.get("WAF_CONTAINER",    "npm_waf")
WAF_PORT        = int(os.environ.get("WAF_PORT",     "8080"))
SYNC_INTERVAL   = int(os.environ.get("SYNC_INTERVAL","30"))

MAPPING_FILE  = Path("/config_data/host_mapping.json")
SNAPSHOT_FILE = Path("/config_data/backend_snapshot.json")
CONF_FILE     = Path("/waf_conf/proxy_hosts.conf")

# {domain: {"scheme": str, "host": str, "port": int}}
_mapping: dict = {}

# Full snapshot of all known real backends, written every time we learn one from NPM.
# Survives restarts and lets us recover mapping when hosts are already redirected to WAF.
_snapshot: dict = {}


def _clean_domain(domain: str) -> str:
    """Strip markdown link syntax if present — e.g. [foo.com](https://foo.com) -> foo.com"""
    m = re.match(r'^\[([^\]]+)\]', domain.strip())
    return m.group(1) if m else domain.strip()

_npm_token: str | None = None
_npm_token_exp: float  = 0


# -- persistence ---------------------------------------------------------------

def _load():
    global _mapping, _snapshot
    MAPPING_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Load primary mapping
    if MAPPING_FILE.exists():
        try:
            raw = json.loads(MAPPING_FILE.read_text())
            _mapping = {_clean_domain(k): v for k, v in raw.items()}
            if _mapping != raw:
                print(f"[load] Fixed {sum(1 for k in raw if _clean_domain(k) != k)} malformed domain key(s)")
        except Exception as e:
            print(f"[load] mapping read error: {e}")
            _mapping = {}

    # Load snapshot -- recovery source when hosts are already pointing at WAF
    if SNAPSHOT_FILE.exists():
        try:
            raw = json.loads(SNAPSHOT_FILE.read_text())
            _snapshot = {_clean_domain(k): v for k, v in raw.items()}
            print(f"[load] snapshot: {len(_snapshot)} backend(s) available for recovery")
        except Exception as e:
            print(f"[load] snapshot read error: {e}")
            _snapshot = {}

    # Recover any missing mappings from snapshot before falling back to static
    recovered = 0
    for domain, backend in _snapshot.items():
        if domain not in _mapping:
            _mapping[domain] = backend
            recovered += 1
    if recovered:
        print(f"[load] Recovered {recovered} backend(s) from snapshot")
        _save()

    # Seed from STATIC_BACKENDS env var (don't overwrite existing entries)
    for entry in STATIC_BACKENDS.split(","):
        entry = entry.strip()
        if "=" not in entry:
            continue
        domain, url = entry.split("=", 1)
        domain, url = domain.strip(), url.strip()
        if not domain or not url:
            continue
        if domain in _mapping:
            continue
        scheme, rest = ("http", url) if "://" not in url else url.split("://", 1)
        rest = rest.rstrip("/")
        host, port = (rest.rsplit(":", 1) if ":" in rest else (rest, "443" if scheme == "https" else "80"))
        _mapping[domain] = {"scheme": scheme, "host": host, "port": int(port)}
        print(f"[static] {domain} -> {scheme}://{host}:{port}")

    _save()


def _save():
    MAPPING_FILE.parent.mkdir(parents=True, exist_ok=True)
    MAPPING_FILE.write_text(json.dumps(_mapping, indent=2))


def _save_snapshot():
    """Persist all known real backends. This is our recovery source on restart."""
    SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_FILE.write_text(json.dumps(_snapshot, indent=2))


# -- NPM API -------------------------------------------------------------------

async def _get_token() -> str | None:
    global _npm_token, _npm_token_exp
    if _npm_token and time.time() < _npm_token_exp - 60:
        return _npm_token
    if not NPM_EMAIL or not NPM_PASSWORD:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"{NPM_API_URL}/api/tokens",
                json={"identity": NPM_EMAIL, "secret": NPM_PASSWORD},
            )
            if r.status_code == 200:
                _npm_token     = r.json()["token"]
                _npm_token_exp = time.time() + 86400
                return _npm_token
            print(f"[token] HTTP {r.status_code}")
    except Exception as e:
        print(f"[token] {e}")
    return None


async def _get_npm_hosts(token: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                f"{NPM_API_URL}/api/nginx/proxy-hosts",
                headers={"Authorization": f"Bearer {token}"},
            )
            if r.status_code == 200:
                return r.json()
            print(f"[hosts] HTTP {r.status_code}")
    except Exception as e:
        print(f"[hosts] {e}")
    return []


_WRITABLE_FIELDS = {
    "domain_names", "forward_host", "forward_port", "forward_scheme",
    "enabled", "ssl_forced", "caching_enabled", "block_exploits",
    "advanced_config", "allow_websocket_upgrade", "http2_support",
    "hsts_enabled", "hsts_subdomains", "certificate_id", "locations", "meta",
}

async def _redirect_host(token: str, host_id: int, host_data: dict) -> bool:
    """Update an NPM proxy host to forward to npm_waf:WAF_PORT.

    Strips read-only fields before the PUT. Skips hosts mid-cert-provisioning.
    """
    meta = host_data.get("meta", {}) or {}
    if meta.get("letsencrypt_agree") and not host_data.get("certificate_id"):
        print(f"[skip]  host {host_id} -- cert provisioning in progress")
        return False

    payload = {k: v for k, v in host_data.items() if k in _WRITABLE_FIELDS}
    payload["forward_host"]   = WAF_CONTAINER
    payload["forward_port"]   = WAF_PORT
    payload["forward_scheme"] = "http"

    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.put(
                f"{NPM_API_URL}/api/nginx/proxy-hosts/{host_id}",
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
            )
            if r.status_code != 200:
                print(f"[redirect] NPM returned {r.status_code}: {r.text[:200]}")
            return r.status_code == 200
    except Exception as e:
        print(f"[redirect] {e}")
        return False


# -- nginx config generation ---------------------------------------------------

def _build_conf() -> str:
    if not _mapping:
        return "# No hosts configured yet -- add proxy hosts in NPM\n"

    blocks = []
    for domain, b in sorted(_mapping.items()):
        upstream = f"{b['scheme']}://{b['host']}:{b['port']}"
        blocks.append(
            f"# {domain}\n"
            f"server {{\n"
            f"    listen {WAF_PORT};\n"
            f"    server_name {domain};\n"
            f"\n"
            f"    location / {{\n"
            f"        proxy_pass {upstream};\n"
            f"        proxy_set_header Host $host;\n"
            f"        proxy_set_header X-Real-IP $remote_addr;\n"
            f"        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
            f"        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;\n"
            f"        proxy_http_version 1.1;\n"
            f"        proxy_set_header Upgrade $http_upgrade;\n"
            f"        proxy_set_header Connection $connection_upgrade;\n"
            f"        proxy_connect_timeout 60s;\n"
            f"        proxy_send_timeout 60s;\n"
            f"        proxy_read_timeout 60s;\n"
            f"        client_max_body_size 0;\n"
            f"    }}\n"
            f"}}"
        )
    return "\n\n".join(blocks) + "\n"


def _write_conf_if_changed(conf: str) -> bool:
    CONF_FILE.parent.mkdir(parents=True, exist_ok=True)
    new_hash = hashlib.md5(conf.encode()).hexdigest()
    old_hash = hashlib.md5(CONF_FILE.read_text().encode()).hexdigest() if CONF_FILE.exists() else ""
    if new_hash == old_hash:
        return False
    CONF_FILE.write_text(conf)
    return True


# -- WAF nginx reload ----------------------------------------------------------

def _reload_waf():
    try:
        import docker
        client    = docker.from_env()
        container = client.containers.get(WAF_CONTAINER)
        result    = container.exec_run("nginx -s reload")
        if result.exit_code == 0:
            print("[waf] nginx reloaded")
        else:
            print(f"[waf] reload failed: {result.output.decode()!r}")
    except Exception as e:
        print(f"[waf] reload error: {e}")


# -- sync loop -----------------------------------------------------------------

async def _sync():
    global _mapping, _snapshot
    changed = False
    snapshot_changed = False

    token = await _get_token()
    if not token:
        print("[sync] No NPM credentials -- running with static config only")
    else:
        hosts = await _get_npm_hosts(token)
        npm_domains: set[str] = set()

        for h in hosts:
            if not h.get("enabled", True):
                continue

            fwd_host   = h.get("forward_host", "")
            fwd_port   = int(h.get("forward_port", 80))
            fwd_scheme = h.get("forward_scheme", "http")

            for domain in h.get("domain_names", []):
                domain = _clean_domain(domain)
                npm_domains.add(domain)

                if fwd_host == WAF_CONTAINER:
                    # Already routing through WAF -- recover backend if missing
                    if domain not in _mapping:
                        if domain in _snapshot:
                            _mapping[domain] = _snapshot[domain]
                            b = _snapshot[domain]
                            print(f"[recover] {domain} -> {b['scheme']}://{b['host']}:{b['port']} (from snapshot)")
                            changed = True
                        else:
                            print(f"[warn] {domain} -> WAF but no backend mapping. "
                                  f"Add to WAF_STATIC_BACKENDS.")
                    continue

                # Real backend discovered -- save to mapping AND snapshot before redirecting
                backend = {"scheme": fwd_scheme, "host": fwd_host, "port": fwd_port}
                if _mapping.get(domain) != backend:
                    print(f"[new]  {domain} -> {fwd_scheme}://{fwd_host}:{fwd_port}")
                    _mapping[domain] = backend
                    _save()
                    changed = True

                # Keep snapshot current -- this is what survives the next restart
                if _snapshot.get(domain) != backend:
                    _snapshot[domain] = backend
                    snapshot_changed = True

                # Auto-redirect in NPM
                if AUTO_REDIRECT:
                    ok = await _redirect_host(token, h["id"], h)
                    if ok:
                        print(f"[npm]  {domain} -> {WAF_CONTAINER}:{WAF_PORT}")
                    else:
                        print(f"[npm]  Failed to redirect {domain}")

        if snapshot_changed:
            _save_snapshot()

        # Remove domains no longer in NPM (and not in static config)
        static_domains = {
            e.split("=")[0].strip()
            for e in STATIC_BACKENDS.split(",")
            if "=" in e
        }
        stale = [d for d in list(_mapping) if d not in npm_domains and d not in static_domains]
        for d in stale:
            print(f"[del]  {d} removed from NPM -- dropping from WAF config")
            del _mapping[d]
            changed = True
        if stale:
            _save()

    # Write conf and reload WAF if anything changed
    conf = _build_conf()
    if _write_conf_if_changed(conf) or changed:
        print(f"[conf] Written {len(_mapping)} host(s)")
        _reload_waf()


async def main():
    _load()
    print(f"[start] WAF config-gen | auto_redirect={AUTO_REDIRECT} | interval={SYNC_INTERVAL}s")
    print(f"[start] {len(_mapping)} backend(s) pre-loaded")

    # Write initial conf so WAF has something to load even before first NPM sync
    conf = _build_conf()
    if _write_conf_if_changed(conf):
        print("[start] Initial conf written")
        _reload_waf()

    while True:
        try:
            await _sync()
        except Exception as e:
            print(f"[error] {e}")
        await asyncio.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
