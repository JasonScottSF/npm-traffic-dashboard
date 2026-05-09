import os, sqlite3, secrets, time, base64, io, re, smtplib, hashlib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path
from datetime import datetime
from fastapi import FastAPI, Request, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import bcrypt
import jwt as pyjwt
import pyotp
import qrcode


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


# ── Config ─────────────────────────────────────────────────────────────────────
APP_NAME      = os.environ.get("APP_NAME", "NPM Dashboard")
APP_URL       = os.environ.get("APP_URL", "").rstrip("/")
TOKEN_EXP     = int(os.environ.get("TOKEN_EXP", str(8 * 3600)))
INVITE_EXP    = int(os.environ.get("INVITE_EXP", str(48 * 3600)))  # 48 h
RESET_EXP     = int(os.environ.get("RESET_EXP",  str(1  * 3600)))  # 1 h for self-service reset
DB_PATH       = Path(os.environ.get("AUTH_DB", "/auth_data/auth.db"))
LOG_PATH      = Path(os.environ.get("AUTH_LOG", "/auth_data/auth.log"))
SECRET_FILE   = Path("/auth_data/.secret")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
ALGORITHM     = "HS256"

# ── SMTP ───────────────────────────────────────────────────────────────────────
SMTP_HOST     = os.environ.get("SMTP_HOST", "")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER     = _read_secret("smtp_user", fallback="")
SMTP_PASSWORD = _read_secret("smtp_password", fallback="")
SMTP_FROM     = os.environ.get("SMTP_FROM", "")
SMTP_ENABLED  = bool(SMTP_HOST and APP_URL)


def _load_secret() -> str:
    SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    if SECRET_FILE.exists():
        return SECRET_FILE.read_text().strip()
    s = secrets.token_hex(32)
    SECRET_FILE.write_text(s)
    return s


SECRET_KEY = _load_secret()
app = FastAPI(title="Auth Service")
templates = Jinja2Templates(directory="/app/templates")


# ── Database ───────────────────────────────────────────────────────────────────
def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _init_db():
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                username       TEXT    UNIQUE NOT NULL,
                email          TEXT,
                password_hash  TEXT    NOT NULL,
                totp_secret    TEXT,
                totp_confirmed INTEGER NOT NULL DEFAULT 0,
                is_admin       INTEGER NOT NULL DEFAULT 0,
                created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Migrations for existing installs
        for col in ("ALTER TABLE users ADD COLUMN email TEXT",
                    "ALTER TABLE users ADD COLUMN name TEXT"):
            try:
                c.execute(col)
            except Exception:
                pass
        c.execute("""
            CREATE TABLE IF NOT EXISTS invites (
                token      TEXT    PRIMARY KEY,
                username   TEXT    UNIQUE NOT NULL,
                email      TEXT,
                is_admin   INTEGER NOT NULL DEFAULT 0,
                expires_at INTEGER NOT NULL,
                used       INTEGER NOT NULL DEFAULT 0,
                kind       TEXT    NOT NULL DEFAULT 'invite',
                created_at TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Migrations for existing installs
        for col in ("ALTER TABLE invites ADD COLUMN email TEXT",
                    "ALTER TABLE invites ADD COLUMN name TEXT"):
            try:
                c.execute(col)
            except Exception:
                pass
        # Migrate: add kind column to existing installs
        try:
            c.execute("ALTER TABLE invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'invite'")
        except Exception:
            pass
        # Audit log — new for this release
        c.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                ts         TEXT NOT NULL DEFAULT (datetime('now')),
                event      TEXT NOT NULL,
                username   TEXT NOT NULL,
                ip         TEXT NOT NULL,
                detail     TEXT
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash  TEXT    PRIMARY KEY,
                username    TEXT    NOT NULL,
                created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                last_seen   TEXT    NOT NULL DEFAULT (datetime('now')),
                ip          TEXT    NOT NULL DEFAULT '',
                user_agent  TEXT    NOT NULL DEFAULT '',
                revoked     INTEGER NOT NULL DEFAULT 0
            )
        """)
        c.commit()


_init_db()


# ── Helpers ────────────────────────────────────────────────────────────────────
def _client_ip(request: Request) -> str:
    return (
        request.headers.get("X-Real-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )


def _audit(event: str, username: str, ip: str, detail: str = ""):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # Write to DB (primary) and file (fallback)
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO audit_log (ts, event, username, ip, detail) VALUES (?,?,?,?,?)",
                (ts, event, username, ip, detail or ""),
            )
            c.commit()
    except Exception:
        pass
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a") as f:
            f.write(f"{ts} {event} user={username} ip={ip}{' — ' + detail if detail else ''}\n")
    except Exception:
        pass


def _hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()


def _check_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def _make_token(username: str, role: str, mfa_ok: bool, partial: bool = False) -> str:
    exp = int(time.time()) + (300 if partial else TOKEN_EXP)
    return pyjwt.encode(
        {"sub": username, "role": role, "mfa_ok": mfa_ok, "partial": partial, "exp": exp},
        SECRET_KEY, algorithm=ALGORITHM,
    )


def _decode_token(token: str) -> dict | None:
    try:
        return pyjwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        return None


def _session(request: Request) -> dict | None:
    return _decode_token(request.cookies.get("session", ""))


def _require_full(request: Request) -> dict:
    s = _session(request)
    if not s or not s.get("mfa_ok") or s.get("partial"):
        raise HTTPException(401, "Not authenticated")
    return s


def _require_admin(request: Request) -> dict:
    s = _require_full(request)
    if s.get("role") != "admin":
        raise HTTPException(403, "Admin required")
    return s


def _get_user(username: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        return dict(row) if row else None


def _get_user_by_email(email: str) -> dict | None:
    try:
        with _conn() as c:
            row = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            return dict(row) if row else None
    except Exception:
        return None


def _user_count() -> int:
    with _conn() as c:
        return c.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def _qr_b64(totp_secret: str, username: str) -> str:
    uri = pyotp.TOTP(totp_secret).provisioning_uri(name=username, issuer_name=APP_NAME)
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _set_cookie(response, token: str, request: Request, partial: bool = False):
    # Derive the Secure flag from the protocol the client actually used.
    # NPM sets X-Forwarded-Proto=https when it terminates TLS; plain HTTP
    # internal/LAN access won't have it, so the cookie stays non-secure and
    # isn't silently dropped by the browser.  COOKIE_SECURE env var is kept
    # as a hard-override (set to "true" to force-secure regardless of proto).
    proto  = request.headers.get("x-forwarded-proto", "http").lower()
    secure = (proto == "https") or COOKIE_SECURE
    response.set_cookie(
        key="session", value=token,
        httponly=True, samesite="strict", secure=secure,
        max_age=300 if partial else TOKEN_EXP,
    )


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:32]


def _record_session(token: str, username: str, request: Request):
    ua = request.headers.get("user-agent", "")[:200]
    ip = _client_ip(request)
    h  = _token_hash(token)
    try:
        with _conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO sessions (token_hash, username, ip, user_agent, created_at, last_seen) "
                "VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))",
                (h, username, ip, ua)
            )
            c.commit()
    except Exception:
        pass


# ── Auth endpoints ─────────────────────────────────────────────────────────────

@app.get("/auth/verify")
def verify(request: Request):
    """nginx auth_request target — returns 200 or 401."""
    s = _session(request)
    if s and s.get("mfa_ok") and not s.get("partial"):
        token = request.cookies.get("session", "")
        h = _token_hash(token)
        try:
            with _conn() as c:
                row = c.execute("SELECT revoked FROM sessions WHERE token_hash=?", (h,)).fetchone()
                if row and row["revoked"]:
                    return Response(status_code=401)
                if row:
                    # Update last-seen on each verified request
                    c.execute("UPDATE sessions SET last_seen=datetime('now') WHERE token_hash=?", (h,))
                else:
                    # Session predates the sessions table — auto-register it now
                    ua = request.headers.get("user-agent", "")[:200]
                    ip = _client_ip(request)
                    c.execute(
                        "INSERT OR IGNORE INTO sessions "
                        "(token_hash, username, ip, user_agent, created_at, last_seen) "
                        "VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))",
                        (h, s["sub"], ip, ua),
                    )
                c.commit()
        except Exception:
            pass
        return Response(status_code=200)
    return Response(status_code=401)


@app.get("/auth/login", response_class=HTMLResponse)
def login_page(request: Request, error: str = ""):
    first_run = _user_count() == 0
    return templates.TemplateResponse("login.html", {
        "request": request, "first_run": first_run,
        "app_name": APP_NAME, "error": error,
        "smtp_enabled": SMTP_ENABLED,
    })


@app.post("/auth/login")
async def login(
    request: Request,
    username:     str = Form(...),   # holds email value on login form
    password:     str = Form(...),
    name:         str = Form(""),    # only used on first-run
    totp_code:    str = Form(""),
    is_first_run: str = Form(""),
):
    ip = _client_ip(request)

    # ── First-run: create admin ───────────────────────────────────────────────
    if is_first_run and _user_count() == 0:
        email = username.strip().lower()
        display_name = name.strip()
        if not display_name:
            return RedirectResponse("/auth/login?error=Name+is+required", 303)
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            return RedirectResponse("/auth/login?error=Valid+email+address+required", 303)
        if len(password) < 8:
            return RedirectResponse("/auth/login?error=Password+must+be+8%2B+characters", 303)
        totp_secret = pyotp.random_base32()
        with _conn() as c:
            c.execute(
                "INSERT INTO users (username,email,name,password_hash,totp_secret,is_admin) VALUES (?,?,?,?,?,1)",
                (email, email, display_name, _hash_pw(password), totp_secret),
            )
            c.commit()
        _audit("ADMIN_CREATED", email, ip)
        token = _make_token(email, "admin", False, partial=True)
        resp = RedirectResponse("/auth/setup", 303)
        _set_cookie(resp, token, request, partial=True)
        return resp

    # ── Normal login — look up by email, fall back to username for legacy accounts ──
    email_input = username.strip().lower()
    user = _get_user_by_email(email_input) or _get_user(email_input)
    if not user or not _check_pw(password, user["password_hash"]):
        _audit("LOGIN_FAILED", email_input or "unknown", ip)
        return RedirectResponse("/auth/login?error=Invalid+credentials", 303)

    role = "admin" if user["is_admin"] else "user"

    # TOTP not set up yet — generate secret and redirect to setup
    if not user["totp_secret"]:
        totp_secret = pyotp.random_base32()
        with _conn() as c:
            c.execute("UPDATE users SET totp_secret=? WHERE username=?", (totp_secret, username))
            c.commit()
        token = _make_token(username, role, False, partial=True)
        resp = RedirectResponse("/auth/setup", 303)
        _set_cookie(resp, token, request, partial=True)
        return resp

    # TOTP secret exists but not confirmed — back to setup
    if not user["totp_confirmed"]:
        token = _make_token(username, role, False, partial=True)
        resp = RedirectResponse("/auth/setup", 303)
        _set_cookie(resp, token, request, partial=True)
        return resp

    # TOTP required
    if not totp_code:
        return RedirectResponse("/auth/login?error=Authenticator+code+required", 303)

    if not pyotp.TOTP(user["totp_secret"]).verify(totp_code.strip(), valid_window=1):
        _audit("LOGIN_FAILED_MFA", username, ip)
        return RedirectResponse("/auth/login?error=Invalid+authenticator+code", 303)

    _audit("LOGIN_OK", username, ip)
    token = _make_token(username, role, True)
    resp = RedirectResponse("/", 303)
    _set_cookie(resp, token, request)
    _record_session(token, username, request)
    return resp


@app.get("/auth/setup", response_class=HTMLResponse)
def setup_page(request: Request):
    s = _session(request)
    if not s or not s.get("partial"):
        return RedirectResponse("/auth/login", 303)
    user = _get_user(s["sub"])
    if not user or not user["totp_secret"]:
        return RedirectResponse("/auth/login", 303)
    return templates.TemplateResponse("setup.html", {
        "request": request, "app_name": APP_NAME,
        "qr_b64": _qr_b64(user["totp_secret"], s["sub"]),
        "totp_secret": user["totp_secret"],
        "error": request.query_params.get("error", ""),
    })


@app.post("/auth/setup")
async def setup_confirm(request: Request, totp_code: str = Form(...)):
    s = _session(request)
    if not s or not s.get("partial"):
        return RedirectResponse("/auth/login", 303)
    user = _get_user(s["sub"])
    if not user or not user["totp_secret"]:
        return RedirectResponse("/auth/login", 303)

    if not pyotp.TOTP(user["totp_secret"]).verify(totp_code.strip(), valid_window=1):
        return RedirectResponse("/auth/setup?error=Invalid+code%2C+try+again", 303)

    with _conn() as c:
        c.execute("UPDATE users SET totp_confirmed=1 WHERE username=?", (s["sub"],))
        c.commit()

    _audit("MFA_SETUP_OK", s["sub"], _client_ip(request))
    role = "admin" if user["is_admin"] else "user"
    token = _make_token(s["sub"], role, True)
    resp = RedirectResponse("/", 303)
    _set_cookie(resp, token, request)
    _record_session(token, s["sub"], request)
    return resp


@app.get("/auth/logout")
def logout(request: Request):
    token = request.cookies.get("session", "")
    if token:
        try:
            with _conn() as c:
                c.execute("UPDATE sessions SET revoked=1 WHERE token_hash=?", (_token_hash(token),))
                c.commit()
        except Exception:
            pass
    resp = RedirectResponse("/auth/login", 303)
    resp.delete_cookie("session")
    return resp


# ── User management API ────────────────────────────────────────────────────────

@app.get("/auth/api/me")
def me(request: Request):
    s = _require_full(request)
    user = _get_user(s["sub"]) or {}
    return {"username": s["sub"], "name": user.get("name"), "email": user.get("email"), "role": s["role"]}


@app.get("/auth/api/users")
def list_users(request: Request):
    _require_admin(request)
    with _conn() as c:
        rows = c.execute(
            "SELECT id,username,name,email,is_admin,totp_confirmed,created_at FROM users ORDER BY id"
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/auth/api/users/{username}/reset-link")
def create_reset_link(username: str, request: Request):
    """Admin generates a password-reset link. The user sets their own new
    password and re-enrolls MFA via the link — admin never sees the password."""
    _require_admin(request)
    user = _get_user(username)
    if not user:
        raise HTTPException(404, "User not found")

    token = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + INVITE_EXP

    with _conn() as c:
        # Replace any existing pending reset/invite for this user
        c.execute("DELETE FROM invites WHERE username=?", (username,))
        c.execute(
            "INSERT INTO invites (token, username, is_admin, expires_at, kind) VALUES (?,?,?,?,?)",
            (token, username, user["is_admin"], expires_at, "reset"),
        )
        c.commit()

    _audit("RESET_LINK_CREATED", username, _client_ip(request))
    return {
        "token": token,
        "username": username,
        "expires_in_hours": INVITE_EXP // 3600,
    }


@app.delete("/auth/api/users/{username}")
def delete_user(username: str, request: Request):
    s = _require_admin(request)
    if username == s["sub"]:
        raise HTTPException(400, "Cannot delete your own account")
    with _conn() as c:
        n = c.execute("DELETE FROM users WHERE username=?", (username,)).rowcount
        # clean up any pending invite for this user too
        c.execute("DELETE FROM invites WHERE username=?", (username,))
        c.commit()
    if n == 0:
        raise HTTPException(404, "User not found")
    return {"success": True}


# ── Invite API ─────────────────────────────────────────────────────────────────

class CreateInvite(BaseModel):
    name: str
    email: str
    is_admin: bool = False


@app.post("/auth/api/invites")
def create_invite(req: CreateInvite, request: Request):
    """Admin creates an invite token for a new user (no password set by admin)."""
    _require_admin(request)
    name  = req.name.strip()
    email = req.email.strip().lower()
    if not name:
        raise HTTPException(400, "Name is required")
    if not email:
        raise HTTPException(400, "Email address is required")
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        raise HTTPException(400, "Invalid email address")

    # Reject if email already exists as a live user
    if _get_user_by_email(email) or _get_user(email):
        raise HTTPException(409, "An account with that email already exists")

    token = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + INVITE_EXP

    with _conn() as c:
        # Replace any existing unused invite for this email
        c.execute("DELETE FROM invites WHERE email=? OR username=?", (email, email))
        c.execute(
            "INSERT INTO invites (token, username, name, email, is_admin, expires_at, kind) VALUES (?,?,?,?,?,?,?)",
            (token, email, name, email, 1 if req.is_admin else 0, expires_at, "invite"),
        )
        c.commit()

    _audit("INVITE_CREATED", email, _client_ip(request))
    return {
        "token": token,
        "email": email,
        "expires_in_hours": INVITE_EXP // 3600,
    }


@app.get("/auth/api/invites")
def list_invites(request: Request):
    """Return pending (unused, unexpired) invites and reset links."""
    _require_admin(request)
    now = int(time.time())
    with _conn() as c:
        rows = c.execute(
            "SELECT token, username, is_admin, expires_at, kind, created_at FROM invites "
            "WHERE used=0 AND expires_at > ? ORDER BY created_at DESC",
            (now,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.delete("/auth/api/invites/{token}")
def revoke_invite(token: str, request: Request):
    """Admin revokes a pending invite."""
    _require_admin(request)
    with _conn() as c:
        n = c.execute("DELETE FROM invites WHERE token=? AND used=0", (token,)).rowcount
        c.commit()
    if n == 0:
        raise HTTPException(404, "Invite not found or already used")
    return {"success": True}


# ── Invite accept pages ────────────────────────────────────────────────────────

def _get_invite(token: str) -> dict | None:
    now = int(time.time())
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM invites WHERE token=? AND used=0 AND expires_at > ?",
            (token, now),
        ).fetchone()
        return dict(row) if row else None


@app.get("/auth/invite/{token}", response_class=HTMLResponse)
def invite_page(token: str, request: Request):
    invite = _get_invite(token)
    if not invite:
        return templates.TemplateResponse("invite_invalid.html", {
            "request": request, "app_name": APP_NAME,
        })

    # If a partial session already exists for this invite's user, they've
    # completed step 1 (password) and are returning to finish MFA setup.
    s = _session(request)
    if s and s.get("partial") and s.get("sub") == invite["username"]:
        user = _get_user(invite["username"])
        if user and user["totp_secret"] and not user["totp_confirmed"]:
            return templates.TemplateResponse("invite.html", {
                "request": request, "app_name": APP_NAME,
                "step": "mfa",
                "kind": invite["kind"],
                "display_name": invite.get("name") or invite["username"],
                "token": token,
                "qr_b64": _qr_b64(user["totp_secret"], invite["username"]),
                "totp_secret": user["totp_secret"],
                "error": request.query_params.get("error", ""),
            })

    # Step 1 — set password
    return templates.TemplateResponse("invite.html", {
        "request": request, "app_name": APP_NAME,
        "step": "password",
        "kind": invite["kind"],
        "display_name": invite.get("name") or invite["username"],
        "email": invite.get("email") or "",
        "token": token,
        "error": request.query_params.get("error", ""),
    })


@app.post("/auth/invite/{token}")
async def invite_accept(
    token: str,
    request: Request,
    step:      str = Form(...),
    password:  str = Form(""),
    password2: str = Form(""),
    totp_code: str = Form(""),
):
    invite = _get_invite(token)
    if not invite:
        return RedirectResponse("/auth/login?error=Invite+link+is+invalid+or+expired", 303)

    username = invite["username"]
    role     = "admin" if invite["is_admin"] else "user"
    ip       = _client_ip(request)

    # ── Step 1: password ──────────────────────────────────────────────────────
    if step == "password":
        if len(password) < 8:
            return RedirectResponse(f"/auth/invite/{token}?error=Password+must+be+8%2B+characters", 303)
        if password != password2:
            return RedirectResponse(f"/auth/invite/{token}?error=Passwords+do+not+match", 303)

        totp_secret = pyotp.random_base32()
        existing = _get_user(username)

        if invite["kind"] == "reset":
            # Password reset — update existing user, clear MFA so step 2 re-enrolls
            if not existing:
                return RedirectResponse("/auth/login?error=Account+not+found", 303)
            with _conn() as c:
                c.execute(
                    "UPDATE users SET password_hash=?, totp_secret=?, totp_confirmed=0 WHERE username=?",
                    (_hash_pw(password), totp_secret, username),
                )
                c.commit()
            _audit("RESET_PASSWORD_SET", username, ip)
        else:
            # New invite — create the account
            if existing and existing["totp_confirmed"]:
                return RedirectResponse("/auth/login?error=Account+already+set+up%2C+please+sign+in", 303)
            if not existing:
                try:
                    with _conn() as c:
                        c.execute(
                            "INSERT INTO users (username,email,name,password_hash,totp_secret,is_admin) VALUES (?,?,?,?,?,?)",
                            (username, invite.get("email"), invite.get("name"), _hash_pw(password), totp_secret, invite["is_admin"]),
                        )
                        c.commit()
                except sqlite3.IntegrityError:
                    return RedirectResponse("/auth/login?error=Account+already+exists", 303)
            _audit("INVITE_PASSWORD_SET", username, ip)

        # Issue partial session and redirect back to GET — the session cookie
        # triggers the MFA step rendering
        partial_token = _make_token(username, role, False, partial=True)
        resp = RedirectResponse(f"/auth/invite/{token}", 303)
        _set_cookie(resp, partial_token, request, partial=True)
        return resp

    # ── Step 2: MFA confirm ───────────────────────────────────────────────────
    if step == "mfa":
        # Require the partial session to belong to this user
        s = _session(request)
        if not s or not s.get("partial") or s.get("sub") != username:
            return RedirectResponse(f"/auth/invite/{token}", 303)

        user = _get_user(username)
        if not user or not user["totp_secret"]:
            return RedirectResponse(f"/auth/invite/{token}", 303)

        if not pyotp.TOTP(user["totp_secret"]).verify(totp_code.strip(), valid_window=1):
            return RedirectResponse(f"/auth/invite/{token}?error=Invalid+code%2C+try+again", 303)

        with _conn() as c:
            c.execute("UPDATE users SET totp_confirmed=1 WHERE username=?", (username,))
            c.execute("UPDATE invites SET used=1 WHERE token=?", (token,))
            c.commit()

        _audit("INVITE_ACCEPTED", username, ip)
        full_token = _make_token(username, role, True)
        resp = RedirectResponse("/", 303)
        _set_cookie(resp, full_token, request)
        _record_session(full_token, username, request)
        return resp

    # Unknown step — restart
    return RedirectResponse(f"/auth/invite/{token}", 303)


# ── Forgot password ────────────────────────────────────────────────────────────

def _send_reset_email(to_email: str, name: str, token: str) -> None:
    reset_url = f"{APP_URL}/auth/invite/{token}"
    subject   = f"{APP_NAME} — Password Reset"
    body      = (
        f"Hi {name},\n\n"
        f"Someone requested a password reset for your {APP_NAME} account.\n\n"
        f"Click the link below to set a new password and re-enroll your authenticator app:\n\n"
        f"  {reset_url}\n\n"
        f"This link expires in {RESET_EXP // 60} minutes and can only be used once.\n\n"
        f"If you didn't request this, you can safely ignore this email — your account is unchanged.\n\n"
        f"— {APP_NAME}"
    )
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = SMTP_FROM or SMTP_USER
    msg["To"]      = to_email
    msg.attach(MIMEText(body, "plain"))

    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as srv:
            if SMTP_USER:
                srv.login(SMTP_USER, SMTP_PASSWORD)
            srv.sendmail(msg["From"], to_email, msg.as_string())
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as srv:
            srv.ehlo()
            srv.starttls()
            if SMTP_USER:
                srv.login(SMTP_USER, SMTP_PASSWORD)
            srv.sendmail(msg["From"], to_email, msg.as_string())


@app.get("/auth/forgot", response_class=HTMLResponse)
def forgot_page(request: Request):
    if not SMTP_ENABLED:
        return RedirectResponse("/auth/login", 303)
    return templates.TemplateResponse("forgot.html", {
        "request": request, "app_name": APP_NAME,
        "submitted": False,
        "error": request.query_params.get("error", ""),
    })


@app.post("/auth/forgot", response_class=HTMLResponse)
async def forgot_submit(request: Request, email: str = Form(...)):
    if not SMTP_ENABLED:
        return RedirectResponse("/auth/login", 303)

    email = email.strip().lower()

    # Always show the same success page — don't reveal whether the email exists
    success_response = templates.TemplateResponse("forgot.html", {
        "request": request, "app_name": APP_NAME,
        "submitted": True,
    })

    user = _get_user_by_email(email)
    if not user:
        return success_response  # silently do nothing

    token      = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + RESET_EXP
    name       = user.get("name") or user["username"]
    username   = user["username"]

    with _conn() as c:
        c.execute("DELETE FROM invites WHERE username=?", (username,))
        c.execute(
            "INSERT INTO invites (token, username, name, email, is_admin, expires_at, kind) VALUES (?,?,?,?,?,?,?)",
            (token, username, name, email, user["is_admin"], expires_at, "reset"),
        )
        c.commit()

    try:
        _send_reset_email(email, name, token)
        _audit("FORGOT_EMAIL_SENT", username, _client_ip(request))
    except Exception as exc:
        _audit("FORGOT_EMAIL_FAILED", f"{username} — {exc}", _client_ip(request))

    return success_response


@app.get("/auth/api/audit")
def get_audit_log(request: Request, limit: int = 200):
    """Return recent audit log entries (admin only)."""
    _require_admin(request)
    with _conn() as c:
        rows = c.execute(
            "SELECT id, ts, event, username, ip, detail FROM audit_log ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/auth/api/sessions")
def list_sessions(request: Request):
    """Return active (non-revoked) sessions for admin view."""
    _require_admin(request)
    with _conn() as c:
        rows = c.execute(
            "SELECT token_hash, username, created_at, last_seen, ip, user_agent, revoked "
            "FROM sessions WHERE revoked=0 ORDER BY last_seen DESC LIMIT 100"
        ).fetchall()
    return [dict(r) for r in rows]


@app.delete("/auth/api/sessions/{token_hash}")
def revoke_session(token_hash: str, request: Request):
    """Admin revokes an active session by token hash."""
    _require_admin(request)
    with _conn() as c:
        c.execute("UPDATE sessions SET revoked=1 WHERE token_hash=?", (token_hash,))
        c.commit()
    return {"success": True}


@app.get("/health")
async def health():
    return {"status": "ok"}
