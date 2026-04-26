import os
import json
import asyncio
import httpx
import uuid
import logging
from collections import deque
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("waf-tester")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from payloads import SUITES

app = FastAPI(title="WAF Tester")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

REQUEST_TIMEOUT = float(os.environ.get("REQUEST_TIMEOUT", "8"))
DELAY_BETWEEN   = float(os.environ.get("DELAY_BETWEEN", "0.2"))

# ── Target configuration ───────────────────────────────────────────────────────
#
# The internal target is always present — it fires directly at the WAF
# container and uses the co-located breach-detector to confirm bypasses.
#
# Additional targets can be added via EXTRA_TARGETS env var as a JSON array:
#   EXTRA_TARGETS='[{"id":"prod","label":"Production","waf_url":"http://npm_waf:8080","breach_url":"http://breach-detector:8090"}]'
#
# Every target MUST have a breach_url — testing without the breach-detector
# agent means bypass detection won't work.

_INTERNAL_TARGET = {
    "id":         "internal",
    "label":      "Internal WAF",
    "waf_url":    os.environ.get("WAF_URL",    "http://npm_waf:8080"),
    "breach_url": os.environ.get("BREACH_URL", "http://breach-detector:8090"),
}

def _load_targets() -> dict:
    targets = {"internal": _INTERNAL_TARGET}
    raw = os.environ.get("EXTRA_TARGETS", "").strip()
    if raw:
        try:
            extra = json.loads(raw)
            for t in extra:
                if t.get("id") and t.get("waf_url") and t.get("breach_url"):
                    targets[t["id"]] = t
                else:
                    log.warning("Skipping invalid EXTRA_TARGETS entry: %s", t)
        except Exception as e:
            log.error("Could not parse EXTRA_TARGETS: %s", e)
    return targets

TARGETS = _load_targets()

# ── State ─────────────────────────────────────────────────────────────────────

runs: deque = deque(maxlen=20)
_runs_by_id: dict = {}

# ── Models ────────────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    suite:     str = "full"
    target_id: str = "internal"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _verdict(payload: dict, status_code: int) -> str:
    # 400: nginx rejects malformed URLs (null bytes, path traversal after normalisation)
    #      before ModSecurity sees them — still effective blocking, count it as blocked.
    # 403/406: ModSecurity explicit deny.
    blocked = status_code in (400, 403, 406)
    if payload["expected"] == "block":
        return "pass" if blocked else "fail"
    else:
        return "pass" if not blocked else "fp"


async def _fire(client: httpx.AsyncClient, payload: dict, run_id: str, target: dict) -> dict:
    test_id   = f"{run_id}:{payload['id']}"
    waf_url   = target["waf_url"]
    breach_url= target["breach_url"]
    headers   = {**payload.get("headers", {}), "X-WAF-Test": test_id}

    error = None
    try:
        resp = await client.request(
            method           = payload["method"],
            url              = waf_url.rstrip("/") + payload["path"],
            params           = payload.get("params") or {},
            headers          = headers,
            content          = payload.get("body"),
            timeout          = REQUEST_TIMEOUT,
            follow_redirects = False,
        )
        status  = resp.status_code
        blocked = status in (403, 406)
    except httpx.TimeoutException:
        status  = 0
        blocked = False
        error   = "timeout"
    except Exception as e:
        status  = -1
        blocked = False
        error   = f"{type(e).__name__}: {e}"
        log.warning("payload %s error: %s", payload["id"], error)

    # Ask the breach-detector agent whether this payload arrived at the backend
    arrived = False
    try:
        br = await client.get(
            f"{breach_url}/api/breach/test/{test_id}",
            timeout=3,
        )
        arrived = br.json().get("arrived", False)
    except Exception:
        pass

    verdict = _verdict(payload, status)
    if arrived and payload["expected"] == "block":
        verdict = "breach"

    return {
        "id":       payload["id"],
        "category": payload["category"],
        "name":     payload["name"],
        "method":   payload["method"],
        "path":     payload["path"],
        "expected": payload["expected"],
        "status":   status,
        "blocked":  blocked,
        "arrived":  arrived,
        "verdict":  verdict,
        "test_id":  test_id,
        "error":    error,
    }


async def _execute(run_id: str, suite_name: str, target: dict) -> None:
    payloads = SUITES.get(suite_name, [])
    run = _runs_by_id[run_id]
    run["total"]  = len(payloads)
    run["status"] = "running"

    async with httpx.AsyncClient(verify=False) as client:
        for payload in payloads:
            result = await _fire(client, payload, run_id, target)
            run["results"].append(result)
            run["done"] += 1

            v = result["verdict"]
            if v == "pass":         run["passed"]          += 1
            elif v == "fail":       run["failed"]          += 1
            elif v == "fp":         run["false_positives"] += 1
            elif v == "breach":     run["breaches"]        += 1

            await asyncio.sleep(DELAY_BETWEEN)

    run["status"]   = "done"
    run["finished"] = datetime.now(timezone.utc).isoformat()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/waf-test/targets")
def list_targets():
    return [
        {"id": t["id"], "label": t["label"], "waf_url": t["waf_url"]}
        for t in TARGETS.values()
    ]


@app.get("/api/waf-test/suites")
def list_suites():
    return [
        {"id": k, "label": k.replace("-", " ").title(), "count": len(v)}
        for k, v in SUITES.items()
    ]


@app.post("/api/waf-test/run")
async def start_run(req: RunRequest):
    if req.suite not in SUITES:
        raise HTTPException(400, f"Unknown suite '{req.suite}'. Valid: {list(SUITES)}")

    target = TARGETS.get(req.target_id)
    if not target:
        raise HTTPException(400, f"Unknown target '{req.target_id}'. Valid: {list(TARGETS)}")

    run_id = str(uuid.uuid4())
    run = {
        "id":              run_id,
        "suite":           req.suite,
        "target_id":       target["id"],
        "target_label":    target["label"],
        "target_waf_url":  target["waf_url"],
        "status":          "queued",
        "started":         datetime.now(timezone.utc).isoformat(),
        "finished":        None,
        "total":           0,
        "done":            0,
        "passed":          0,
        "failed":          0,
        "false_positives": 0,
        "breaches":        0,
        "results":         [],
    }
    runs.appendleft(run)
    _runs_by_id[run_id] = run

    asyncio.create_task(_execute(run_id, req.suite, target))
    return {"run_id": run_id}


@app.get("/api/waf-test/runs")
def list_runs():
    return [
        {k: v for k, v in r.items() if k != "results"}
        for r in runs
    ]


@app.get("/api/waf-test/runs/{run_id}")
def get_run(run_id: str):
    run = _runs_by_id.get(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@app.get("/health")
async def health():
    return {"status": "ok"}
