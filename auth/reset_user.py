#!/usr/bin/env python3
"""
Admin CLI: reset a user's password and MFA, print a one-time reset link.

Usage (run inside the auth container):
  python3 reset_user.py <email-or-username> [app-url]

Examples:
  python3 reset_user.py aja175
  python3 reset_user.py aja175 https://dash.example.com
  python3 reset_user.py admin@example.com https://dash.example.com

If app-url is omitted, APP_URL from the environment is used.
The reset link opens a page where the user sets a new password and re-enrolls MFA.
"""

import os, sqlite3, secrets, time, sys
from pathlib import Path

DB_PATH  = Path(os.environ.get("AUTH_DB", "/auth_data/auth.db"))
APP_URL  = (sys.argv[2] if len(sys.argv) > 2 else os.environ.get("APP_URL", "")).rstrip("/")
LOOKUP   = sys.argv[1].strip() if len(sys.argv) > 1 else ""
RESET_EXP = int(os.environ.get("RESET_EXP", str(48 * 3600)))

if not LOOKUP:
    print("Usage: python3 reset_user.py <email-or-username> [app-url]")
    sys.exit(1)

conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row

# Find user by username or email
user = conn.execute("SELECT * FROM users WHERE username=?", (LOOKUP,)).fetchone()
if not user:
    try:
        user = conn.execute("SELECT * FROM users WHERE email=?", (LOOKUP,)).fetchone()
    except Exception:
        pass

if not user:
    print(f"ERROR: no user found for '{LOOKUP}'")
    conn.close()
    sys.exit(1)

username = user["username"]
name     = user["name"] or username
email    = user["email"] or username
token    = secrets.token_urlsafe(32)
expires  = int(time.time()) + RESET_EXP

# Remove any existing pending invite/reset for this user
conn.execute("DELETE FROM invites WHERE username=?", (username,))
conn.execute(
    "INSERT INTO invites (token, username, name, email, is_admin, expires_at, kind) VALUES (?,?,?,?,?,?,?)",
    (token, username, name, email, user["is_admin"], expires, "reset"),
)
conn.commit()
conn.close()

print()
print(f"  User    : {name} ({email})")
print(f"  Expires : {RESET_EXP // 3600}h from now")
print()

if APP_URL:
    print(f"  Reset link:")
    print(f"  {APP_URL}/auth/invite/{token}")
else:
    print(f"  Token (append to your dashboard URL as /auth/invite/<token>):")
    print(f"  {token}")

print()
print("  The user will set a new password and re-enroll MFA when they open the link.")
print()
