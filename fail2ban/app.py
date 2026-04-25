import os
import re
import subprocess
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Fail2Ban API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SOCKET        = Path("/var/run/fail2ban/fail2ban.sock")
F2B_LOG       = Path(os.environ.get("F2B_LOG", "/f2b_data/fail2ban.log"))
JAIL_LOCAL    = Path("/etc/fail2ban/jail.local")
JAIL_D        = Path("/etc/fail2ban/jail.d")


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


# ── Jail management ──────────────────────────────────────────────────────────

CANNED_JAILS = {
    "sshd": {
        "name": "sshd",
        "description": "Block brute-force SSH login attempts",
        "filter": "sshd",
        "logpath": "/host-logs/auth.log",
        "port": "ssh",
        "maxretry": 3,
        "findtime": "10m",
        "bantime": "24h",
        "backend": "auto",
    },
    "npm-http-auth": {
        "name": "npm-http-auth",
        "description": "Block repeated 401 Unauthorized on NPM proxied hosts",
        "filter": "npm-http-auth",
        "logpath": "/npm_logs/proxy-host-*_access.log\n           /npm_logs/default-host_access.log",
        "port": "http,https",
        "maxretry": 10,
        "findtime": "5m",
        "bantime": "30m",
        "backend": "auto",
    },
    "npm-badbots": {
        "name": "npm-badbots",
        "description": "Block known scanners and exploit tools (nikto, nmap, sqlmap, etc.)",
        "filter": "npm-badbots",
        "logpath": "/npm_logs/proxy-host-*_access.log\n           /npm_logs/default-host_access.log",
        "port": "http,https",
        "maxretry": 2,
        "findtime": "1m",
        "bantime": "24h",
        "backend": "auto",
    },
    "apache-auth": {
        "name": "apache-auth",
        "description": "Block Apache HTTP auth failures",
        "filter": "apache-auth",
        "logpath": "/host-logs/apache2/error.log",
        "port": "http,https",
        "maxretry": 5,
        "findtime": "10m",
        "bantime": "1h",
        "backend": "auto",
    },
    "postfix": {
        "name": "postfix",
        "description": "Block Postfix SMTP abuse",
        "filter": "postfix",
        "logpath": "/host-logs/mail.log",
        "port": "smtp,465,submission",
        "maxretry": 5,
        "findtime": "10m",
        "bantime": "1h",
        "backend": "auto",
    },
    "recidive": {
        "name": "recidive",
        "description": "Long-term ban for repeat offenders across all jails",
        "filter": "recidive",
        "logpath": "/f2b_data/fail2ban.log",
        "port": "all",
        "maxretry": 5,
        "findtime": "1d",
        "bantime": "7d",
        "backend": "auto",
    },
}


def _write_jail_config(jail_name: str, config: dict) -> str:
    lines = [f"[{jail_name}]", "enabled = true"]
    for key in ("filter", "logpath", "port", "maxretry", "findtime", "bantime", "backend"):
        if key in config and config[key] is not None:
            lines.append(f"{key} = {config[key]}")
    if config.get("action"):
        lines.append(f"action = {config['action']}")
    return "\n".join(lines) + "\n"


@app.get("/api/f2b/canned_jails")
def canned_jails():
    return list(CANNED_JAILS.values())


class JailConfig(BaseModel):
    name: str
    filter: str
    logpath: str
    port: str = "http,https"
    maxretry: int = 5
    findtime: str = "10m"
    bantime: str = "1h"
    backend: str = "auto"
    action: str = ""


def reload_jail(name: str) -> tuple[bool, str]:
    """Reload a specific jail; fall back to full reload. Returns (ok, warning_or_empty)."""
    ok, _, err = f2b("reload", name)
    if ok:
        return True, ""
    # Specific jail reload failed — try full reload
    ok2, _, err2 = f2b("reload")
    if ok2:
        return True, ""
    return False, err2 or err


@app.post("/api/f2b/jail/create")
def create_jail(cfg: JailConfig):
    name = re.sub(r"[^a-z0-9_-]", "", cfg.name.lower())
    if not name:
        raise HTTPException(400, "Invalid jail name")

    jail_file = JAIL_D / f"{name}.local"
    content = _write_jail_config(name, cfg.dict())

    try:
        JAIL_D.mkdir(parents=True, exist_ok=True)
        jail_file.write_text(content)
    except Exception as e:
        raise HTTPException(500, f"Could not write jail config: {e}")

    ok, warning = reload_jail(name)
    if not ok:
        return {"success": False, "warning": f"Config written but reload failed: {warning}. Restart fail2ban to apply."}

    return {"success": True, "jail": name, "file": str(jail_file)}


@app.delete("/api/f2b/jail/{name}")
def delete_jail(name: str):
    jail_file = JAIL_D / f"{name}.local"
    if not jail_file.exists():
        raise HTTPException(404, f"No managed jail config found for '{name}'")
    try:
        jail_file.unlink()
    except Exception as e:
        raise HTTPException(500, f"Could not remove jail config: {e}")

    f2b("reload")
    return {"success": True, "jail": name}


@app.get("/api/f2b/jail/{name}/config")
def jail_config(name: str):
    jail_file = JAIL_D / f"{name}.local"
    if not jail_file.exists():
        return {"managed": False, "content": ""}
    return {"managed": True, "content": jail_file.read_text()}


class RawJailConfig(BaseModel):
    name: str
    content: str


@app.put("/api/f2b/jail/raw")
def update_jail_raw(cfg: RawJailConfig):
    name = re.sub(r"[^a-z0-9_-]", "", cfg.name.lower())
    if not name:
        raise HTTPException(400, "Invalid jail name")
    jail_file = JAIL_D / f"{name}.local"
    try:
        JAIL_D.mkdir(parents=True, exist_ok=True)
        jail_file.write_text(cfg.content)
    except Exception as e:
        raise HTTPException(500, str(e))
    ok, warning = reload_jail(name)
    if not ok:
        return {"success": False, "warning": f"Config written but reload failed: {warning}"}
    return {"success": True}
