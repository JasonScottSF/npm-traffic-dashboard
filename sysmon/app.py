import os
import time
import psutil
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

ROOTFS = "/rootfs"
REAL_FSTYPES = {"ext2","ext3","ext4","xfs","btrfs","zfs","vfat","fat32","ntfs","exfat","f2fs","jfs","reiserfs","udf"}

# Docker bind-mounts individual host files into containers; these pass the fstype
# check but are not real mount points.
_INJECTED_FILES = {"resolv.conf", "hostname", "hosts", "localtime", "machine-id", "nsswitch.conf"}
_SKIP_PREFIXES  = ("/proc/", "/sys/", "/dev/", "/run/", "/var/lib/docker/")

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

    disks = []
    try:
        with open("/host/proc/mounts") as f:
            mounts = [line.split() for line in f if len(line.split()) >= 4]

        seen = {}  # device -> entry; deduplicate so each physical disk appears once
        for parts in mounts:
            device, mountpoint, fstype = parts[0], parts[1], parts[2]

            if fstype not in REAL_FSTYPES:
                continue
            # Skip Docker-injected file bind-mounts and non-disk paths
            if os.path.basename(mountpoint) in _INJECTED_FILES:
                continue
            if any(mountpoint.startswith(p) for p in _SKIP_PREFIXES):
                continue

            host_path = os.path.join(ROOTFS, mountpoint.lstrip("/"))
            try:
                st = os.statvfs(host_path)
                total = st.f_blocks * st.f_frsize
                if total == 0:
                    continue
                free = st.f_bavail * st.f_frsize
                used = total - (st.f_bfree * st.f_frsize)
                entry = {
                    "device":     device,
                    "mountpoint": mountpoint,
                    "fstype":     fstype,
                    "total":      total,
                    "used":       used,
                    "free":       free,
                    "percent":    round(used / total * 100, 1),
                }
                # For the same device keep the entry with the shortest mountpoint
                # (closest to the root of the partition).
                if device not in seen or len(mountpoint) < len(seen[device]["mountpoint"]):
                    seen[device] = entry
            except (OSError, ZeroDivisionError):
                pass

        disks = sorted(seen.values(), key=lambda d: d["mountpoint"])
    except Exception:
        pass

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
        "disks":  disks,
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
