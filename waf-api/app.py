import csv
import io
import os
import json
import time
import threading
from collections import deque, Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import geoip2.database
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from rules import get_rule_meta, top_severity

app = FastAPI(title="WAF API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AUDIT_LOG  = Path(os.environ.get("WAF_AUDIT_LOG", "/waf_logs/audit.log"))
WAF_MODE   = os.environ.get("WAF_MODE", "DetectionOnly")
GEOIP_DB   = Path(os.environ.get("GEOIP_DB", "/geoip/GeoLite2-Country.mmdb"))
WAF_DLQ    = Path(os.environ.get("WAF_DLQ", "/waf_logs/audit/dlq.jsonl"))
MAX_EVENTS = 2000

# ── Dead letter queue ─────────────────────────────────────────────────────────

def _dlq_append(raw: str, error: str):
    """Save unparseable audit log JSON to the dead letter queue file."""
    try:
        WAF_DLQ.parent.mkdir(parents=True, exist_ok=True)
        with open(WAF_DLQ, "a") as fh:
            json.dump({
                "ts":    datetime.now(timezone.utc).isoformat(),
                "error": error,
                "raw":   raw[:500],
            }, fh)
            fh.write("\n")
    except Exception:
        pass


# ── In-memory event store ─────────────────────────────────────────────────────

events: deque = deque(maxlen=MAX_EVENTS)
_lock = threading.Lock()

# ── GeoIP ─────────────────────────────────────────────────────────────────────

_geo_reader = None

def _get_country(ip: str) -> Optional[str]:
    global _geo_reader
    try:
        if _geo_reader is None and GEOIP_DB.exists():
            _geo_reader = geoip2.database.Reader(str(GEOIP_DB))
        if _geo_reader:
            return _geo_reader.country(ip).country.iso_code
    except Exception:
        pass
    return None

# ── Audit log parsing ─────────────────────────────────────────────────────────

def _parse_ts(ts_str: str) -> datetime:
    """Parse ModSecurity timestamp formats into a UTC datetime."""
    if not ts_str:
        return datetime.now(timezone.utc)
    # ModSec 3.x: "Fri Apr 25 10:00:00 2026" or "25/Apr/2026:10:00:00 +0000"
    for fmt in ("%a %b %d %H:%M:%S %Y", "%d/%b/%Y:%H:%M:%S"):
        try:
            s = ts_str.split(" +")[0].split(" -")[0]
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    # ISO fallback
    try:
        return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


def _process(obj: dict) -> None:
    """Convert a parsed audit log JSON object into an event dict and store it."""
    txn      = obj.get("transaction", obj)   # ModSec 3.x wraps in "transaction"
    messages = txn.get("messages", [])

    if not messages:
        return   # only store events where rules actually fired

    # Field names differ between ModSec 2.x and 3.x
    ip       = txn.get("client_ip") or txn.get("remote_address", "")
    ts       = _parse_ts(txn.get("time_stamp") or txn.get("time", ""))
    req      = txn.get("request", {})
    resp     = txn.get("response", {})
    resp_code = int(resp.get("http_code") or resp.get("status") or 0)

    # Build per-rule details
    rules_hit = []
    for msg in messages:
        details   = msg.get("details", {})
        rule_id   = str(details.get("ruleId") or details.get("id") or "")
        severity  = (details.get("severity") or "NOTICE").upper()
        meta      = get_rule_meta(rule_id)
        rules_hit.append({
            "rule_id":       rule_id,
            "severity":      severity,
            "message":       msg.get("message", ""),
            "matched_data":  details.get("data") or details.get("match") or "",
            "reference":     details.get("reference", ""),
            "tags":          details.get("tags") or [],
            "category":      meta["category"],
            "attack_type":   meta["attack_type"],
            "description":   meta["description"],
            "remediation":   meta["remediation"],
            "owasp_category": meta["owasp_category"],
            "owasp_top10":   meta["owasp_top10"],
            "crs_doc_url":   meta["crs_doc_url"],
            "owasp_url":     meta["owasp_url"],
            "risk":          meta["risk"],
        })

    best_sev    = top_severity(messages)
    attack_types = [r["attack_type"] for r in rules_hit if r["attack_type"] != "Unknown"]
    primary     = attack_types[0] if attack_types else "Unknown"

    req_headers  = req.get("headers") or {}
    resp_headers = resp.get("headers") or {}

    # Scrub sensitive request headers before storing
    _SCRUB = {"authorization", "cookie", "x-api-key", "x-auth-token"}
    safe_req_headers = {k: ("[redacted]" if k.lower() in _SCRUB else v)
                        for k, v in req_headers.items()}

    event = {
        "id":              txn.get("unique_id") or txn.get("transaction_id") or str(ts.timestamp()),
        "ts":              ts.isoformat(),
        "ts_epoch":        ts.timestamp(),
        "ip":              ip,
        "country":         _get_country(ip) if ip else None,
        "method":          req.get("method", "-"),
        "uri":             req.get("uri", "-"),
        "response_code":   resp_code,
        "blocked":         resp_code == 403,
        "rule_count":      len(rules_hit),
        "top_severity":    best_sev,
        "attack_type":     primary,
        "rules":           rules_hit,
        "user_agent":      req_headers.get("User-Agent", ""),
        "request_headers": safe_req_headers,
        "request_body":    (req.get("body") or "")[:4096],   # cap at 4 KB
        "response_headers": resp_headers,
        "response_body":   (resp.get("body") or "")[:4096],  # part E if present
    }

    with _lock:
        events.appendleft(event)


def _tail_log() -> None:
    """Background thread: tail AUDIT_LOG and parse ModSec JSON transactions."""
    import logging
    log = logging.getLogger("waf-tail")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [waf-api] %(message)s")

    AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)

    # Wait for log file to appear (WAF container may not start immediately)
    while not AUDIT_LOG.exists():
        log.info(f"Waiting for audit log at {AUDIT_LOG} ...")
        time.sleep(5)

    log.info(f"Audit log found: {AUDIT_LOG} ({AUDIT_LOG.stat().st_size} bytes)")

    with open(AUDIT_LOG, "r", errors="replace") as fh:
        # Seek back up to 512KB from end so we pick up recent history on startup
        fh.seek(0, 2)
        size = fh.tell()
        lookback = min(size, 512 * 1024)
        fh.seek(size - lookback)
        if lookback < size:
            fh.readline()  # skip the partial first line we landed in the middle of
        log.info(f"Reading from offset {fh.tell()} of {size} bytes")

        buf = ""
        depth = 0
        while True:
            line = fh.readline()
            if not line:
                time.sleep(0.5)
                continue

            stripped = line.strip()

            # Try single-line NDJSON first (most common with Serial + JSON format)
            if stripped.startswith("{") and stripped.endswith("}") and buf == "":
                try:
                    _process(json.loads(stripped))
                    continue
                except json.JSONDecodeError as e:
                    _dlq_append(stripped, str(e))
                    continue

            # Accumulate multi-line JSON
            buf += line
            depth += stripped.count("{") - stripped.count("}")
            if depth <= 0 and buf.strip():
                try:
                    _process(json.loads(buf))
                except json.JSONDecodeError as e:
                    _dlq_append(buf[:500], str(e))
                buf = ""
                depth = 0


# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    t = threading.Thread(target=_tail_log, daemon=True, name="waf-log-tailer")
    t.start()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _since_epoch(since: str) -> float:
    hours = {
        "1h": 1, "6h": 6, "12h": 12, "24h": 24,
        "3d": 72, "7d": 168, "30d": 720,
    }.get(since, 24)
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).timestamp()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/waf/events")
def get_events(
    limit:        int           = Query(100, ge=1, le=500),
    since:        str           = Query("24h"),
    attack_type:  Optional[str] = Query(None),
    ip:           Optional[str] = Query(None),
    blocked_only: bool          = Query(False),
    severity:     Optional[str] = Query(None),
):
    cutoff = _since_epoch(since)
    with _lock:
        result = [
            e for e in events
            if e["ts_epoch"] >= cutoff
            and (not attack_type or attack_type.lower() in e["attack_type"].lower())
            and (not ip          or ip in e["ip"])
            and (not blocked_only or e["blocked"])
            and (not severity    or e["top_severity"].upper() == severity.upper())
        ]
    return result[:limit]


@app.get("/api/waf/stats")
def get_stats(since: str = Query("24h")):
    cutoff = _since_epoch(since)
    with _lock:
        window = [e for e in events if e["ts_epoch"] >= cutoff]

    if not window:
        return {
            "total_events":          0,
            "blocked":               0,
            "detected":              0,
            "unique_ips":            0,
            "top_attack_type":       None,
            "top_ip":                None,
            "top_country":           None,
            "severity_breakdown":    {},
            "attack_type_breakdown": {},
            "ip_breakdown":          {},
            "country_breakdown":     {},
            "mode":                  WAF_MODE,
        }

    attack_counts  = Counter(e["attack_type"] for e in window)
    ip_counts      = Counter(e["ip"] for e in window)
    country_counts = Counter(e["country"] for e in window if e["country"])
    sev_counts     = Counter(e["top_severity"] for e in window)
    blocked_count  = sum(1 for e in window if e["blocked"])

    return {
        "total_events":          len(window),
        "blocked":               blocked_count,
        "detected":              len(window) - blocked_count,
        "unique_ips":            len(ip_counts),
        "top_attack_type":       attack_counts.most_common(1)[0][0] if attack_counts else None,
        "top_ip":                ip_counts.most_common(1)[0][0] if ip_counts else None,
        "top_country":           country_counts.most_common(1)[0][0] if country_counts else None,
        "severity_breakdown":    dict(sev_counts.most_common()),
        "attack_type_breakdown": dict(attack_counts.most_common(10)),
        "ip_breakdown":          dict(ip_counts.most_common(10)),
        "country_breakdown":     dict(country_counts.most_common(10)),
        "mode":                  WAF_MODE,
    }


@app.get("/api/waf/mode")
def get_mode():
    return {"mode": WAF_MODE}


@app.get("/api/waf/export.csv")
def export_events(since: str = Query("24h")):
    cutoff = _since_epoch(since)
    with _lock:
        snapshot = [e for e in events if e["ts_epoch"] >= cutoff]

    def generate():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["timestamp", "ip", "country", "method", "uri",
                    "response_code", "blocked", "top_severity", "attack_type",
                    "rule_count", "user_agent"])
        yield buf.getvalue()
        for e in snapshot:
            buf.seek(0); buf.truncate(0)
            w.writerow([e["ts"], e["ip"], e.get("country") or "",
                        e["method"], e["uri"], e["response_code"],
                        e["blocked"], e["top_severity"], e["attack_type"],
                        e["rule_count"], (e.get("user_agent") or "")[:200]])
            yield buf.getvalue()

    return StreamingResponse(generate(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="waf-events-{since}.csv"'})


@app.get("/health")
async def health():
    return {"status": "ok"}
