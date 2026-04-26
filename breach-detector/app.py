"""
breach-detector/app.py

Transparent reverse-proxy that sits between the WAF and the frontend.
Traffic path:  WAF → breach-detector:8090 → frontend:80

For every request that passes the WAF it:
  1. Inspects path / query / body / headers with signatures.inspect()
  2. Records a "breach event" if an attack signature matches
  3. Tracks X-WAF-Test headers so waf-tester can confirm WAF bypasses
  4. Proxies the request to the real frontend

Own API paths are served directly (not forwarded):
  GET /api/breach/events          — recent breach events
  GET /api/breach/stats           — summary counts
  GET /api/breach/test/{test_id}  — did this test ID arrive?
  GET /api/breach/health          — liveness probe
"""

import os
import asyncio
import logging
from collections import deque
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

import aiohttp
from aiohttp import web

from signatures import inspect as sig_inspect

# ── Config ────────────────────────────────────────────────────────────────────

UPSTREAM        = os.environ.get("UPSTREAM_URL", "http://npm_dashboard_frontend:80")
PORT            = int(os.environ.get("PORT", "8090"))
MAX_BODY_BYTES  = int(os.environ.get("MAX_BODY_BYTES", str(64 * 1024)))   # 64 KB
MAX_EVENTS      = int(os.environ.get("MAX_EVENTS", "500"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("breach-detector")

# ── State ─────────────────────────────────────────────────────────────────────

breach_events: deque = deque(maxlen=MAX_EVENTS)
_event_counter: int = 0

# test_id → True  (only store arrivals that have a WAF-Test header)
test_arrivals: dict = {}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _client_ip(request: web.Request) -> str:
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.remote or "unknown"


def _short_body(raw: bytes) -> str:
    try:
        return raw[:200].decode("utf-8", errors="replace")
    except Exception:
        return ""


async def _read_body(request: web.Request) -> bytes:
    """Read up to MAX_BODY_BYTES from the request body."""
    try:
        return await asyncio.wait_for(
            request.read(),
            timeout=5.0,
        )
    except (asyncio.TimeoutError, Exception):
        return b""


def _record_event(request: web.Request, body_raw: bytes, sig_match: dict, test_id: str | None) -> None:
    global _event_counter
    _event_counter += 1
    query_str = request.query_string or ""
    event = {
        "id":        _event_counter,
        "ts":        datetime.now(timezone.utc).isoformat(),
        "client_ip": _client_ip(request),
        "method":    request.method,
        "path":      request.path,
        "query":     query_str[:500],
        "sig_id":    sig_match["sig_id"],
        "sig_name":  sig_match["name"],
        "severity":  sig_match["severity"],
        "category":  sig_match["category"],
        "matched_in": sig_match["target"],
        "matched_snippet": sig_match["matched"],
        "test_id":   test_id,
    }
    breach_events.appendleft(event)
    log.warning(
        "BREACH %s %s%s — %s [%s]",
        request.method, request.path,
        f"?{query_str}" if query_str else "",
        sig_match["name"],
        sig_match["severity"],
    )


# ── Own API handlers ───────────────────────────────────────────────────────────

async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "events": len(breach_events)})


async def handle_events(request: web.Request) -> web.Response:
    limit  = min(int(request.rel_url.query.get("limit", "100")), MAX_EVENTS)
    events = list(breach_events)[:limit]
    return web.json_response(events)


async def handle_stats(request: web.Request) -> web.Response:
    events = list(breach_events)

    by_category: dict = {}
    by_severity: dict = {}
    by_ip:       dict = {}

    for e in events:
        by_category[e["category"]] = by_category.get(e["category"], 0) + 1
        by_severity[e["severity"]] = by_severity.get(e["severity"], 0) + 1
        by_ip[e["client_ip"]]      = by_ip.get(e["client_ip"], 0) + 1

    return web.json_response({
        "total":       len(events),
        "by_category": by_category,
        "by_severity": by_severity,
        "top_ips":     sorted(by_ip.items(), key=lambda x: -x[1])[:10],
    })


async def handle_ack_one(request: web.Request) -> web.Response:
    """Acknowledge (remove) a single breach event by its id."""
    try:
        event_id = int(request.match_info["event_id"])
    except (KeyError, ValueError):
        return web.json_response({"error": "invalid id"}, status=400)
    kept = [e for e in breach_events if e["id"] != event_id]
    breach_events.clear()
    for e in reversed(kept):
        breach_events.appendleft(e)
    return web.json_response({"ok": True, "remaining": len(breach_events)})


async def handle_ack_all(request: web.Request) -> web.Response:
    """Acknowledge (clear) all breach events."""
    breach_events.clear()
    return web.json_response({"ok": True})


async def handle_test_lookup(request: web.Request) -> web.Response:
    test_id = request.match_info["test_id"]
    arrived = test_id in test_arrivals
    return web.json_response({"test_id": test_id, "arrived": arrived})


# ── Proxy handler ──────────────────────────────────────────────────────────────

HOP_BY_HOP = frozenset([
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
])


async def handle_proxy(request: web.Request) -> web.Response:
    session: aiohttp.ClientSession = request.app["session"]

    # ── Read body ──────────────────────────────────────────────────────────────
    body_raw = await _read_body(request)

    # ── Check for WAF-Test header ─────────────────────────────────────────────
    test_id = request.headers.get("X-WAF-Test")
    if test_id:
        test_arrivals[test_id] = True
        log.info("WAF-Test arrived: %s", test_id)

    # ── Signature inspection ───────────────────────────────────────────────────
    headers_flat = dict(request.headers)
    sig_match = sig_inspect(
        path    = request.path,
        query   = request.query_string or "",
        body    = _short_body(body_raw),
        headers = headers_flat,
    )
    if sig_match:
        _record_event(request, body_raw, sig_match, test_id)

    # ── Forward to upstream ───────────────────────────────────────────────────
    upstream_url = UPSTREAM.rstrip("/") + str(request.raw_path)

    # Strip hop-by-hop headers before forwarding
    fwd_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in HOP_BY_HOP
    }

    try:
        async with session.request(
            method  = request.method,
            url     = upstream_url,
            headers = fwd_headers,
            data    = body_raw or None,
            allow_redirects = False,
            timeout = aiohttp.ClientTimeout(total=30),
        ) as upstream_resp:
            resp_body = await upstream_resp.read()

            # Strip hop-by-hop from response too
            resp_headers = {
                k: v for k, v in upstream_resp.headers.items()
                if k.lower() not in HOP_BY_HOP
            }

            return web.Response(
                status  = upstream_resp.status,
                headers = resp_headers,
                body    = resp_body,
            )

    except aiohttp.ClientConnectorError as exc:
        log.error("Upstream connection failed: %s", exc)
        return web.Response(status=502, text="Bad Gateway")
    except asyncio.TimeoutError:
        log.error("Upstream timed out: %s", upstream_url)
        return web.Response(status=504, text="Gateway Timeout")
    except Exception as exc:
        log.error("Proxy error: %s", exc)
        return web.Response(status=500, text="Internal Server Error")


# ── App factory ───────────────────────────────────────────────────────────────

async def on_startup(app: web.Application) -> None:
    connector = aiohttp.TCPConnector(limit=100, ssl=False)
    app["session"] = aiohttp.ClientSession(connector=connector)
    log.info("breach-detector started — upstream=%s port=%d", UPSTREAM, PORT)


async def on_cleanup(app: web.Application) -> None:
    await app["session"].close()


def create_app() -> web.Application:
    app = web.Application(client_max_size=MAX_BODY_BYTES * 2)

    # Own API routes (matched before the catch-all proxy)
    app.router.add_get("/api/breach/health",                handle_health)
    app.router.add_get("/api/breach/events",                handle_events)
    app.router.add_get("/api/breach/stats",                 handle_stats)
    app.router.add_delete("/api/breach/events",             handle_ack_all)
    app.router.add_delete("/api/breach/events/{event_id}",  handle_ack_one)
    app.router.add_get("/api/breach/test/{test_id}",        handle_test_lookup)

    # Catch-all proxy — must come last
    app.router.add_route("*", "/{path_info:.*}", handle_proxy)

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    return app


if __name__ == "__main__":
    web.run_app(create_app(), host="0.0.0.0", port=PORT)
