#!/usr/bin/env python3
"""
Validate that a fresh install can actually start.

WHY THIS EXISTS
---------------
Two of the last three fixes to this project were not features breaking - they
were the INSTALL PATH breaking, silently, and a stranger finding out:

  #10  secrets named in the compose file were never created by setup.sh, so
       Compose refused to start any container that referenced them
  #11  nginx rebuilt relative redirects using its in-container port, so the
       published port was dropped on login

Nothing in the repo checked either case. The code was fine; the path a new
user walks was not, and the only test was somebody's evening.

This script walks that path statically. It needs no Docker daemon, no network
and no secrets, so it runs in CI on every push.

Checks:
  1. every secret a service uses is declared, and setup.sh creates it
  2. every ${VAR} in the compose file is documented in .env.example or has an
     inline default
  3. the compose file parses with ONLY .env.example and empty secret files -
     which is precisely the state of a fresh clone
  4. setup.sh is valid bash

Exit 0 = a fresh clone should come up. Exit 1 = it will not.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAIL = []
WARN = []


def fail(msg):
    FAIL.append(msg)


def warn(msg):
    WARN.append(msg)


def load_compose():
    try:
        import yaml
    except ImportError:
        print("PyYAML is required: pip install pyyaml", file=sys.stderr)
        sys.exit(2)
    return yaml.safe_load((ROOT / "docker-compose.yml").read_text())


def check_secrets(compose, setup):
    declared = set((compose.get("secrets") or {}).keys())
    used = set()
    for name, svc in (compose.get("services") or {}).items():
        for s in (svc.get("secrets") or []):
            used.add(s if isinstance(s, str) else s.get("source"))

    created = set(re.findall(r"write_secret\s+([A-Za-z0-9_]+)", setup))
    created |= set(re.findall(r"secrets/([A-Za-z0-9_]+)\.txt", setup))
    for blob in re.findall(r"ALL_SECRETS=\(([^)]*)\)", setup, re.S):
        created |= set(re.findall(r"[A-Za-z0-9_]+", blob))

    for s in sorted(used - declared):
        fail(f"secret '{s}' is used by a service but not declared in the "
             f"top-level 'secrets:' block")
    for s in sorted(used - created):
        fail(f"secret '{s}' is used by a service but setup.sh never creates "
             f"secrets/{s}.txt - Compose will refuse to start that container")
    for s in sorted(declared - used):
        warn(f"secret '{s}' is declared but no service uses it")


def check_env(compose_text, envex):
    used = set(re.findall(r"\$\{([A-Z0-9_]+)(?::-[^}]*)?\}", compose_text))
    defaulted = set(re.findall(r"\$\{([A-Z0-9_]+):-[^}]*\}", compose_text))
    documented = set(re.findall(r"^\s*#?\s*([A-Z0-9_]+)=", envex, re.M))

    for v in sorted(used - documented - defaulted):
        fail(f"${{{v}}} is referenced in docker-compose.yml with no inline "
             f"default and no entry in .env.example - a fresh install gets an "
             f"empty value")
    for v in sorted(used - documented):
        warn(f"${{{v}}} is not in .env.example (it has a default, so this is "
             f"documentation only)")


def check_compose_parses(compose):
    """Parse with only .env.example and empty secrets: a fresh clone's state."""
    if not (ROOT / ".env.example").exists():
        fail(".env.example is missing")
        return
    have = subprocess.run(["docker", "compose", "version"],
                          capture_output=True)
    if have.returncode != 0:
        warn("docker compose not available; skipped the parse check")
        return

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / ".env").write_text((ROOT / ".env.example").read_text())
        secrets = tmp / "secrets"
        secrets.mkdir()
        for s in (compose.get("secrets") or {}):
            (secrets / f"{s}.txt").write_text("placeholder")
        # Symlink build contexts rather than copying the tree.
        for item in ROOT.iterdir():
            if item.name in (".env", "secrets", ".git"):
                continue
            (tmp / item.name).symlink_to(item)

        r = subprocess.run(["docker", "compose", "config"],
                           cwd=tmp, capture_output=True, text=True)
        if r.returncode != 0:
            fail("docker compose config failed on a fresh-clone simulation:\n"
                 + "\n".join("      " + l for l in r.stderr.splitlines()[:15]))


def check_setup_syntax():
    r = subprocess.run(["bash", "-n", str(ROOT / "setup.sh")],
                       capture_output=True, text=True)
    if r.returncode != 0:
        fail("setup.sh is not valid bash:\n" + r.stderr)


def main():
    compose = load_compose()
    compose_text = (ROOT / "docker-compose.yml").read_text()
    setup = (ROOT / "setup.sh").read_text()
    envex = (ROOT / ".env.example").read_text()

    check_secrets(compose, setup)
    check_env(compose_text, envex)
    check_compose_parses(compose)
    check_setup_syntax()

    for w in WARN:
        print(f"  warning: {w}")
    for f in FAIL:
        print(f"  ERROR:   {f}")

    if FAIL:
        print(f"\n{len(FAIL)} problem(s) would break a fresh install.")
        return 1
    print(f"\nInstall path OK ({len(WARN)} warning(s)).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
