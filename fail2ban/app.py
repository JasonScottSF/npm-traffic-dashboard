import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Fail2Ban API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

F2B_LOG = Path(os.environ.get("F2B_LOG", "/var/log/fail2ban.log")) if False else Path("/var/log/fail2ban.log")
SOCKET   = Path("/var/run/fail2ban/fail2ban.sock")

import os
F2B_LOG = Path(os.environ.get("F2B_LOG", "/var/log/fail2ban.log"))


def f2b(*args, timeout=10):
    try:
        r = subprocess.run(
            ["fail2ban-client", "-s", str(SOCKET)] + list(args),
            capture_output=True, text=True, timeout=timeout
        )
        return r.returncode == 0, r.stdout.strip(), r.stderr.strip()
    except FileNotFoundError:
        return False, "", "fail2ban-client not found"
    except subprocess.TimeoutExpired:
        return False, "", "timeout"
    except Exception as e:
        return False, "", str(e)


def parse_jail_status(raw: str) -> dict:
    def extract(pattern, text, cast=str, default=None):
        m = re.search(pattern, text)
        return cast(m.group(1).strip()) if m else default

    banned_str = extract(r"Banned IP list:\s*(.*?)$", raw, str, "")
    banned_ips = [ip.strip() for ip in banned_str.split() if ip.strip()] if banned_str else []

    return {
        "currently_failed": extract(r"Currently failed:\s*(\d+)", raw, int, 0),
        "total_failed":     extract(r"Total failed:\s*(\d+)", raw, int, 0),
        "currently_banned": extract(r"Currently banned:\s*(\d+)", raw, int, 0),
        "total_banned":     extract(r"Total banned:\s*(\d+)", raw, int, 0),
        "banned_ips":       banned_ips,
        "file_list":        extract(r"File list:\s*(.*?)$", raw, str, ""),
    }


@app.get("/api/f2b/status")
def status():
    ok, out, err = f2b("ping")
    running = ok and "pong" in out.lower()

    if not running:
        return {"running": False, "jails": [], "total_banned": 0, "total_failed": 0, "error": err}

    ok2, out2, _ = f2b("status")
    jail_list = []
    if ok2:
        m = re.search(r"Jail list:\s*(.+)", out2)
        if m:
            jail_list = [j.strip() for j in m.group(1).split(",") if j.strip()]

    return {
        "running": True,
        "jails": jail_list,
        "jail_count": len(jail_list),
        "socket": str(SOCKET),
    }


@app.get("/api/f2b/jails")
def jails():
    ok, out, err = f2b("status")
    if not ok:
        raise HTTPException(503, detail=f"fail2ban unavailable: {err}")

    m = re.search(r"Jail list:\s*(.+)", out)
    jail_names = [j.strip() for j in m.group(1).split(",")] if m else []

    result = []
    for name in jail_names:
        ok2, out2, _ = f2b("status", name)
        if ok2:
            data = parse_jail_status(out2)
            data["name"] = name
            result.append(data)

    return result


@app.get("/api/f2b/jail/{name}")
def jail_detail(name: str):
    ok, out, err = f2b("status", name)
    if not ok:
        raise HTTPException(404, detail=f"Jail '{name}' not found: {err}")
    data = parse_jail_status(out)
    data["name"] = name
    return data


class UnbanRequest(BaseModel):
    jail: str
    ip: str


@app.post("/api/f2b/unban")
def unban(req: UnbanRequest):
    ok, out, err = f2b("set", req.jail, "unbanip", req.ip)
    if not ok:
        raise HTTPException(400, detail=f"Unban failed: {err or out}")
    return {"success": True, "jail": req.jail, "ip": req.ip}


@app.post("/api/f2b/ban")
def ban(req: UnbanRequest):
    ok, out, err = f2b("set", req.jail, "banip", req.ip)
    if not ok:
        raise HTTPException(400, detail=f"Ban failed: {err or out}")
    return {"success": True, "jail": req.jail, "ip": req.ip}


LOG_RE = re.compile(
    r"(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ "
    r"fail2ban\.(?P<component>\w+)\s+\[\d+\]: (?P<level>\w+)\s+"
    r"(?:\[(?P<jail>[^\]]+)\] )?(?P<message>.+)"
)


@app.get("/api/f2b/log")
def log(lines: int = 200, jail: str = ""):
    if not F2B_LOG.exists():
        return []

    try:
        raw = subprocess.run(
            ["tail", "-n", str(lines * 2), str(F2B_LOG)],
            capture_output=True, text=True
        ).stdout.splitlines()
    except Exception:
        return []

    events = []
    for line in raw:
        m = LOG_RE.match(line)
        if not m:
            continue
        entry = m.groupdict()
        if jail and entry.get("jail") != jail:
            continue
        events.append(entry)

    return list(reversed(events[-lines:]))


@app.get("/api/f2b/banned")
def all_banned():
    ok, out, _ = f2b("status")
    if not ok:
        return []

    m = re.search(r"Jail list:\s*(.+)", out)
    jail_names = [j.strip() for j in m.group(1).split(",")] if m else []

    result = []
    for name in jail_names:
        ok2, out2, _ = f2b("status", name)
        if ok2:
            data = parse_jail_status(out2)
            for ip in data["banned_ips"]:
                result.append({"jail": name, "ip": ip})

    return result
