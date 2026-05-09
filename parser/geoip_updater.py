"""Downloads/updates the MaxMind GeoLite2-Country database."""
import os
import sys
import urllib.request
import tarfile
import shutil
from pathlib import Path


def _read_secret(name: str, fallback: str = None) -> str:
    """Read a secret from /run/secrets/<name>; fall back to env var with a warning."""
    try:
        return open(f"/run/secrets/{name}").read().strip()
    except FileNotFoundError:
        val = os.environ.get(name.upper(), fallback)
        if val is not None:
            print(f"[WARN] Secret '{name}' read from env — migrate to /run/secrets/", flush=True)
            return val
        raise RuntimeError(f"Secret '{name}' not found in /run/secrets/ or environment")


LICENSE_KEY = _read_secret("maxmind_license_key", fallback="")
GEOIP_DB = os.environ.get("GEOIP_DB", "/geoip/GeoLite2-Country.mmdb")
DOWNLOAD_URL = (
    "https://download.maxmind.com/app/geoip_download"
    "?edition_id=GeoLite2-Country&license_key={key}&suffix=tar.gz"
)

DAEMON_MODE = os.environ.get("GEOIP_DAEMON", "false").lower() == "true"
UPDATE_INTERVAL = int(os.environ.get("GEOIP_INTERVAL_HOURS", "24")) * 3600


def download():
    if not LICENSE_KEY:
        print("No MAXMIND_LICENSE_KEY set — skipping GeoIP download.")
        return False
    print("Downloading GeoLite2-Country database...")
    url = DOWNLOAD_URL.format(key=LICENSE_KEY)
    tmp = "/tmp/geolite2.tar.gz"
    urllib.request.urlretrieve(url, tmp)
    with tarfile.open(tmp) as tf:
        for member in tf.getmembers():
            if member.name.endswith("GeoLite2-Country.mmdb"):
                member.name = os.path.basename(member.name)
                tf.extract(member, "/tmp/")
                break
    os.makedirs(os.path.dirname(GEOIP_DB), exist_ok=True)
    shutil.move("/tmp/GeoLite2-Country.mmdb", GEOIP_DB)
    print(f"GeoIP database saved to {GEOIP_DB}")
    return True


if __name__ == "__main__":
    import time
    download()
    if DAEMON_MODE:
        print(f"Daemon mode: will re-download every {UPDATE_INTERVAL // 3600}h")
        while True:
            time.sleep(UPDATE_INTERVAL)
            download()
