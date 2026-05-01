import time
import psutil
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="System Monitor API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_boot_time = psutil.boot_time()


def fmt_uptime(seconds: float) -> str:
    s = int(seconds)
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    parts = []
    if d: parts.append(f"{d}d")
    if h: parts.append(f"{h}h")
    if m: parts.append(f"{m}m")
    parts.append(f"{s}s")
    return " ".join(parts)


@app.get("/api/sys/stats")
def stats():
    cpu_pct    = psutil.cpu_percent(interval=0.5)
    cpu_freq   = psutil.cpu_freq()
    cpu_count  = psutil.cpu_count(logical=True)
    cpu_cores  = psutil.cpu_count(logical=False)

    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()

    net_io = psutil.net_io_counters(pernic=False)
    net_ifaces = []
    for name, stats in psutil.net_io_counters(pernic=True).items():
        addrs = psutil.net_if_addrs().get(name, [])
        ipv4 = next((a.address for a in addrs if a.family.name == "AF_INET"), None)
        net_ifaces.append({
            "name":         name,
            "ip":           ipv4,
            "bytes_sent":   stats.bytes_sent,
            "bytes_recv":   stats.bytes_recv,
            "packets_sent": stats.packets_sent,
            "packets_recv": stats.packets_recv,
            "errin":        stats.errin,
            "errout":       stats.errout,
        })

    temps = {}
    try:
        raw_temps = psutil.sensors_temperatures()
        for sensor, readings in raw_temps.items():
            temps[sensor] = [
                {"label": r.label or sensor, "current": r.current, "high": r.high, "critical": r.critical}
                for r in readings
            ]
    except AttributeError:
        pass  # not available on all platforms

    fans = {}
    try:
        raw_fans = psutil.sensors_fans()
        for sensor, readings in raw_fans.items():
            fans[sensor] = [{"label": r.label or sensor, "current": r.current} for r in readings]
    except AttributeError:
        pass

    load = list(psutil.getloadavg()) if hasattr(psutil, "getloadavg") else []

    procs = sorted(
        [
            {
                "pid":    p.info["pid"],
                "name":   p.info["name"],
                "cpu":    p.info["cpu_percent"],
                "mem_mb": round(p.info["memory_info"].rss / 1e6, 1) if p.info["memory_info"] else 0,
                "status": p.info["status"],
            }
            for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_info", "status"])
            if p.info["cpu_percent"] is not None
        ],
        key=lambda x: x["cpu"],
        reverse=True,
    )[:15]

    uptime_secs = time.time() - _boot_time

    return {
        "uptime":    fmt_uptime(uptime_secs),
        "uptime_s":  uptime_secs,
        "cpu": {
            "percent":    cpu_pct,
            "count":      cpu_count,
            "cores":      cpu_cores,
            "freq_mhz":   round(cpu_freq.current) if cpu_freq else None,
            "freq_max":   round(cpu_freq.max) if cpu_freq else None,
            "load_1":     load[0] if len(load) > 0 else None,
            "load_5":     load[1] if len(load) > 1 else None,
            "load_15":    load[2] if len(load) > 2 else None,
        },
        "memory": {
            "total":     mem.total,
            "available": mem.available,
            "used":      mem.used,
            "percent":   mem.percent,
            "cached":    getattr(mem, "cached", 0),
            "buffers":   getattr(mem, "buffers", 0),
        },
        "swap": {
            "total":   swap.total,
            "used":    swap.used,
            "free":    swap.free,
            "percent": swap.percent,
        },
        "net": {
            "total": {
                "bytes_sent": net_io.bytes_sent,
                "bytes_recv": net_io.bytes_recv,
            },
            "interfaces": net_ifaces,
        },
        "temps":    temps,
        "fans":     fans,
        "processes": procs,
    }


@app.get("/api/sys/history")
def history():
    """Lightweight endpoint for sparkline data — returns current snapshot for client-side accumulation."""
    cpu_pct = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory()
    net = psutil.net_io_counters()
    return {
        "ts":         time.time(),
        "cpu":        cpu_pct,
        "mem":        mem.percent,
        "bytes_sent": net.bytes_sent,
        "bytes_recv": net.bytes_recv,
    }


@app.get("/api/sys/containers")
async def containers():
    """Query the Docker daemon via unix socket for container state."""
    try:
        transport = httpx.AsyncHTTPTransport(uds="/var/run/docker.sock")
        async with httpx.AsyncClient(transport=transport, base_url="http://docker") as client:
            resp = await client.get("/containers/json?all=1", timeout=5)
            raw = resp.json()
    except Exception as e:
        return {"error": str(e), "containers": []}

    result = []
    for c in raw:
        names = [n.lstrip("/") for n in c.get("Names", [])]
        hc    = c.get("Health") or {}
        result.append({
            "name":   names[0] if names else c.get("Id", "")[:12],
            "image":  c.get("Image", "").split(":")[0],
            "state":  c.get("State", ""),          # running | exited | paused | …
            "status": c.get("Status", ""),          # human string e.g. "Up 2 hours"
            "health": hc.get("Status"),             # healthy | unhealthy | starting | None
        })
    return {"containers": sorted(result, key=lambda x: x["name"])}


@app.get("/health")
async def health():
    return {"status": "ok"}
