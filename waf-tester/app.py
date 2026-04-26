import os
import asyncio
import httpx
import uuid
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Optional

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("waf-tester")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from payloads import SUITES, ALL_PAYLOADS

app = FastAPI(title="WAF Tester")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

WAF_URL          = os.environ.get("WAF_URL", "http://npm_waf:8080")
BREACH_URL       = os.environ.get("BREACH_URL", "http://breach-detector:8090")
REQUEST_TIMEOUT  = float(os.environ.get("REQUEST_TIMEOUT", "8"))
DELAY_BETWEEN    = float(os.environ.get("DELAY_BETWEEN", "0.2"))

# ── State ─────────────────────────────────────────────────────────────────────

runs: deque = deque(maxlen=20)
_runs_by_id: dict = {}

# ── Models ────────────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    suite:      str = "full"
    target_url: Optional[str] = None   # overrides WAF_URL if set


# ── Helpers ───────────────────────────────────────────────────────────────────

def _verdict(payload: dict, status_code: int) -> str:
    """Return 'pass', 'fail', or 'fp' (false positive)."""
    blocked = status_code in (403, 406)
    if payload["expected"] == "block":
        return "pass" if blocked else "fail"
    else:  # expected to pass
        return "pass" if not blocked else "fp"


async def _fire(client: httpx.AsyncClient, payload: dict, run_id: str, target_url: str) -> dict:
    test_id = f"{run_id}:{payload['id']}"
    headers = {**payload.get("headers", {}), "X-WAF-Test": test_id}

    error = None
    try:
        resp = await client.request(
            method  = payload["method"],
            url     = target_url.rstrip("/") + payload["path"],
            params  = payload.get("params") or {},
            headers = headers,
            content = payload.get("body"),
            timeout = REQUEST_TIMEOUT,
            follow_redirects = False,
        )
        status = resp.status_code
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

    # Ask breach-detector if this test ID arrived behind the WAF
    arrived = False
    try:
        br = await client.get(
            f"{BREACH_URL}/api/breach/test/{test_id}",
            timeout=3,
        )
        arrived = br.json().get("arrived", False)
    except Exception:
        pass

    verdict = _verdict(payload, status)
    if arrived and payload["expected"] == "block":
        verdict = "breach"  # WAF returned 403 but payload still reached the backend

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


async def _execute(run_id: str, suite_name: str, target_url: str) -> None:
    payloads = SUITES.get(suite_name, [])
    run = _runs_by_id[run_id]
    run["total"]  = len(payloads)
    run["status"] = "running"

    async with httpx.AsyncClient(verify=False) as client:
        for payload in payloads:
            result = await _fire(client, payload, run_id, target_url)
            run["results"].append(result)
            run["done"] += 1

            v = result["verdict"]
            if v == "pass":
                run["passed"] += 1
            elif v == "fail":
                run["failed"] += 1
            elif v == "fp":
                run["false_positives"] += 1
            elif v == "breach":
                run["breaches"] += 1

            await asyncio.sleep(DELAY_BETWEEN)

    run["status"]   = "done"
    run["finished"] = datetime.now(timezone.utc).isoformat()


# ── Endpoints ─────────────────────────────────────────────────────────────────

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

    target_url = (req.target_url or "").strip() or WAF_URL

    run_id = str(uuid.uuid4())
    run = {
        "id":              run_id,
        "suite":           req.suite,
        "target_url":      target_url,
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

    asyncio.create_task(_execute(run_id, req.suite, target_url))
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
