import os, sqlite3, secrets, time, base64, io, re
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

# ── Config ─────────────────────────────────────────────────────────────────────
APP_NAME    = os.environ.get("APP_NAME", "NPM Dashboard")
TOKEN_EXP   = int(os.environ.get("TOKEN_EXP", str(8 * 3600)))
DB_PATH     = Path(os.environ.get("AUTH_DB", "/auth_data/auth.db"))
LOG_PATH    = Path(os.environ.get("AUTH_LOG", "/auth_data/auth.log"))
SECRET_FILE = Path("/auth_data/.secret")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
ALGORITHM   = "HS256"


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
                password_hash  TEXT    NOT NULL,
                totp_secret    TEXT,
                totp_confirmed INTEGER NOT NULL DEFAULT 0,
                is_admin       INTEGER NOT NULL DEFAULT 0,
                created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
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


def _audit(event: str, username: str, ip: str):
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with LOG_PATH.open("a") as f:
        f.write(f"{ts} {event} user={username} ip={ip}\n")


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


def _user_count() -> int:
    with _conn() as c:
        return c.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def _qr_b64(totp_secret: str, username: str) -> str:
    uri = pyotp.TOTP(totp_secret).provisioning_uri(name=username, issuer_name=APP_NAME)
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _set_cookie(response, token: str, partial: bool = False):
    response.set_cookie(
        key="session", value=token,
        httponly=True, samesite="strict", secure=COOKIE_SECURE,
        max_age=300 if partial else TOKEN_EXP,
    )


# ── Auth endpoints ─────────────────────────────────────────────────────────────

@app.get("/auth/verify")
def verify(request: Request):
    """nginx auth_request target — returns 200 or 401."""
    s = _session(request)
    if s and s.get("mfa_ok") and not s.get("partial"):
        return Response(status_code=200)
    return Response(status_code=401)


@app.get("/auth/login", response_class=HTMLResponse)
def login_page(request: Request, error: str = ""):
    first_run = _user_count() == 0
    return templates.TemplateResponse("login.html", {
        "request": request, "first_run": first_run,
        "app_name": APP_NAME, "error": error,
    })


@app.post("/auth/login")
async def login(
    request: Request,
    username:    str = Form(...),
    password:    str = Form(...),
    totp_code:   str = Form(""),
    is_first_run: str = Form(""),
):
    ip = _client_ip(request)

    # ── First-run: create admin ───────────────────────────────────────────────
    if is_first_run and _user_count() == 0:
        username = username.strip()
        if len(username) < 3:
            return RedirectResponse("/auth/login?error=Username+must+be+3%2B+characters", 303)
        if len(password) < 8:
            return RedirectResponse("/auth/login?error=Password+must+be+8%2B+characters", 303)
        if not re.match(r'^[a-zA-Z0-9_.-]+$', username):
            return RedirectResponse("/auth/login?error=Invalid+username+characters", 303)
        totp_secret = pyotp.random_base32()
        with _conn() as c:
            c.execute(
                "INSERT INTO users (username,password_hash,totp_secret,is_admin) VALUES (?,?,?,1)",
                (username, _hash_pw(password), totp_secret),
            )
            c.commit()
        _audit("ADMIN_CREATED", username, ip)
        token = _make_token(username, "admin", False, partial=True)
        resp = RedirectResponse("/auth/setup", 303)
        _set_cookie(resp, token, partial=True)
        return resp

    # ── Normal login ──────────────────────────────────────────────────────────
    user = _get_user(username.strip())
    if not user or not _check_pw(password, user["password_hash"]):
        _audit("LOGIN_FAILED", username or "unknown", ip)
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
        _set_cookie(resp, token, partial=True)
        return resp

    # TOTP secret exists but not confirmed — back to setup
    if not user["totp_confirmed"]:
        token = _make_token(username, role, False, partial=True)
        resp = RedirectResponse("/auth/setup", 303)
        _set_cookie(resp, token, partial=True)
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
    _set_cookie(resp, token)
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
    _set_cookie(resp, token)
    return resp


@app.get("/auth/logout")
def logout():
    resp = RedirectResponse("/auth/login", 303)
    resp.delete_cookie("session")
    return resp


# ── User management API ────────────────────────────────────────────────────────

@app.get("/auth/api/me")
def me(request: Request):
    s = _require_full(request)
    return {"username": s["sub"], "role": s["role"]}


@app.get("/auth/api/users")
def list_users(request: Request):
    _require_admin(request)
    with _conn() as c:
        rows = c.execute(
            "SELECT id,username,is_admin,totp_confirmed,created_at FROM users ORDER BY id"
        ).fetchall()
    return [dict(r) for r in rows]


class CreateUser(BaseModel):
    username: str
    password: str
    is_admin: bool = False


@app.post("/auth/api/users")
def create_user(req: CreateUser, request: Request):
    _require_admin(request)
    username = req.username.strip()
    if len(username) < 3:
        raise HTTPException(400, "Username must be 3+ characters")
    if len(req.password) < 8:
        raise HTTPException(400, "Password must be 8+ characters")
    if not re.match(r'^[a-zA-Z0-9_.-]+$', username):
        raise HTTPException(400, "Invalid username characters")
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO users (username,password_hash,is_admin) VALUES (?,?,?)",
                (username, _hash_pw(req.password), 1 if req.is_admin else 0),
            )
            c.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Username already exists")
    return {"success": True, "username": username}


class ResetPassword(BaseModel):
    password: str


@app.put("/auth/api/users/{username}/password")
def reset_password(username: str, req: ResetPassword, request: Request):
    _require_admin(request)
    if len(req.password) < 8:
        raise HTTPException(400, "Password must be 8+ characters")
    with _conn() as c:
        n = c.execute(
            "UPDATE users SET password_hash=?, totp_secret=NULL, totp_confirmed=0 WHERE username=?",
            (_hash_pw(req.password), username),
        ).rowcount
        c.commit()
    if n == 0:
        raise HTTPException(404, "User not found")
    return {"success": True}


@app.delete("/auth/api/users/{username}")
def delete_user(username: str, request: Request):
    s = _require_admin(request)
    if username == s["sub"]:
        raise HTTPException(400, "Cannot delete your own account")
    with _conn() as c:
        n = c.execute("DELETE FROM users WHERE username=?", (username,)).rowcount
        c.commit()
    if n == 0:
        raise HTTPException(404, "User not found")
    return {"success": True}
