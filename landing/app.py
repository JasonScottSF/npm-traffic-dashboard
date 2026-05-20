import asyncio
import json
import os
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

app = FastAPI()

DATA_FILE    = Path("/landing_data/hosts.json")
NPM_API_URL  = os.environ.get("NPM_API_URL",      "http://nginx_proxy_manager:81")
NPM_EMAIL    = os.environ.get("NPM_API_EMAIL",     "")
NPM_PASSWORD = os.environ.get("NPM_API_PASSWORD",  "")
SYNC_INTERVAL = int(os.environ.get("SYNC_INTERVAL", "60"))

# ── In-memory state ───────────────────────────────────────────────────────────
_npm_hosts: list[dict]  = []   # [{domain, source:"npm"}]
_manual:    dict        = {}   # {domain: {label, url}}
_labels:    dict        = {}   # {domain: label} — override for any host
_status:    dict        = {}   # {domain: "online"|"offline"|"checking"}
_npm_token: str | None  = None
_npm_token_exp: float   = 0
_lock = asyncio.Lock()


# ── Persistence ───────────────────────────────────────────────────────────────
def _load():
    global _manual, _labels
    if DATA_FILE.exists():
        d = json.loads(DATA_FILE.read_text())
        _manual = d.get("manual", {})
        _labels = d.get("labels", {})
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

def _save():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps({"manual": _manual, "labels": _labels}, indent=2))


# ── NPM sync ──────────────────────────────────────────────────────────────────
async def _npm_token_get() -> str | None:
    global _npm_token, _npm_token_exp
    if _npm_token and time.time() < _npm_token_exp - 60:
        return _npm_token
    if not NPM_EMAIL or not NPM_PASSWORD:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"{NPM_API_URL}/api/tokens",
                json={"identity": NPM_EMAIL, "secret": NPM_PASSWORD, "expiry": "1d"},
            )
            if r.status_code == 200:
                _npm_token = r.json()["token"]
                _npm_token_exp = time.time() + 86400
                return _npm_token
    except Exception:
        pass
    return None

async def _npm_sync():
    global _npm_hosts
    token = await _npm_token_get()
    if not token:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                f"{NPM_API_URL}/api/nginx/proxy-hosts",
                headers={"Authorization": f"Bearer {token}"},
            )
            if r.status_code != 200:
                return
            hosts = []
            for h in r.json():
                if not h.get("enabled", True):
                    continue
                for domain in h.get("domain_names", []):
                    hosts.append({"domain": domain, "source": "npm"})
            async with _lock:
                _npm_hosts = hosts
    except Exception:
        pass


# ── Status checks ─────────────────────────────────────────────────────────────
async def _check(domain: str):
    _status[domain] = "checking"
    for scheme in ("https", "http"):
        try:
            async with httpx.AsyncClient(timeout=5, follow_redirects=True) as c:
                r = await c.get(f"{scheme}://{domain}")
                _status[domain] = "online" if r.status_code < 500 else "offline"
                return
        except Exception:
            pass
    _status[domain] = "offline"

async def _check_all():
    domains = {h["domain"] for h in _npm_hosts} | set(_manual)
    await asyncio.gather(*[_check(d) for d in domains])


# ── Background worker ─────────────────────────────────────────────────────────
async def _worker():
    while True:
        await _npm_sync()
        await _check_all()
        await asyncio.sleep(SYNC_INTERVAL)


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def _startup():
    _load()
    asyncio.create_task(_worker())


# ── Helpers ───────────────────────────────────────────────────────────────────
def _merged() -> list[dict]:
    seen, result = set(), []

    for h in _npm_hosts:
        d = h["domain"]
        if d in seen:
            continue
        seen.add(d)
        result.append({
            "domain": d,
            "label":  _labels.get(d, ""),
            "source": "npm",
            "status": _status.get(d, "checking"),
            "url":    f"https://{d}",
        })

    for d, meta in _manual.items():
        if d in seen:
            continue
        seen.add(d)
        result.append({
            "domain": d,
            "label":  _labels.get(d, meta.get("label", "")),
            "source": "manual",
            "status": _status.get(d, "checking"),
            "url":    meta.get("url") or f"https://{d}",
        })

    return sorted(result, key=lambda x: x["domain"])


# ── API ───────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/api/hosts")
async def get_hosts():
    return _merged()

@app.post("/api/sync")
async def force_sync():
    await _npm_sync()
    await _check_all()
    return {"status": "ok"}


class ManualHost(BaseModel):
    domain: str
    label:  str = ""
    url:    str = ""

@app.post("/api/hosts/manual")
async def add_manual(host: ManualHost):
    d = host.domain.strip().lower().lstrip("https://").lstrip("http://").rstrip("/")
    if not d:
        raise HTTPException(400, "domain required")
    _manual[d] = {"label": host.label, "url": host.url or f"https://{d}"}
    _save()
    asyncio.create_task(_check(d))
    return {"status": "ok"}

@app.delete("/api/hosts/manual/{domain}")
async def del_manual(domain: str):
    if domain not in _manual:
        raise HTTPException(404, "not found")
    del _manual[domain]
    _save()
    return {"status": "ok"}

@app.post("/api/hosts/{domain}/label")
async def set_label(domain: str, body: dict):
    _labels[domain] = body.get("label", "")
    _save()
    return {"status": "ok"}


# ── Frontend ──────────────────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def index():
    return (Path("/app/static/index.html")).read_text()
