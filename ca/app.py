"""
Internal CA service — issues and manages TLS certificates signed by a local root CA.

Generates a root CA on first startup (RSA 4096, 10-year validity). Issues leaf
certs (RSA 2048, 365-day validity) for proxy hosts and Docker-internal services.
Pushes issued certs to NPM via its REST API. Auto-renews certs approaching expiry.
"""

import asyncio
import hashlib
import ipaddress
import os
import stat
import zipfile
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import List, Optional

import aiohttp
import asyncpg
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Internal CA API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Config ────────────────────────────────────────────────────────────────────

DATABASE_URL       = os.environ["DATABASE_URL"]
NPM_API_URL        = os.environ.get("NPM_API_URL", "http://nginx_proxy_manager:81")
NPM_EMAIL          = os.environ.get("NPM_API_EMAIL", "")
NPM_PASSWORD       = os.environ.get("NPM_API_PASSWORD", "")
CA_COMMON_NAME     = os.environ.get("CA_COMMON_NAME", "Internal CA")
CA_DATA            = Path(os.environ.get("CA_DATA_DIR", "/ca_data"))
RENEW_DAYS         = int(os.environ.get("CA_RENEW_DAYS", "30"))
CERT_VALIDITY_DAYS = int(os.environ.get("CA_CERT_VALIDITY_DAYS", "365"))

_pool: asyncpg.Pool = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _pool


# ── Schema ────────────────────────────────────────────────────────────────────

async def _ensure_schema(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS ca_issued_certs (
                id            SERIAL PRIMARY KEY,
                domain        TEXT NOT NULL UNIQUE,
                sans          TEXT[] NOT NULL DEFAULT '{}',
                cert_type     TEXT NOT NULL DEFAULT 'proxy',
                serial        TEXT NOT NULL,
                not_before    TIMESTAMPTZ NOT NULL,
                not_after     TIMESTAMPTZ NOT NULL,
                npm_cert_id   INT,
                npm_pushed_at TIMESTAMPTZ,
                push_error    TEXT,
                revoked       BOOLEAN NOT NULL DEFAULT FALSE,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)


# ── Root CA bootstrap ─────────────────────────────────────────────────────────

def _ensure_root_ca():
    """Generate root CA key + self-signed cert if they don't already exist."""
    CA_DATA.mkdir(parents=True, exist_ok=True)
    key_path  = CA_DATA / "ca.key"
    cert_path = CA_DATA / "ca.crt"

    if key_path.exists() and cert_path.exists():
        print("[ca] Root CA already exists — skipping generation")
        return

    print(f"[ca] Generating root CA: {CA_COMMON_NAME}")

    # RSA 4096 private key
    key = rsa.generate_private_key(public_exponent=65537, key_size=4096)

    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    key_path.write_bytes(key_pem)
    os.chmod(key_path, stat.S_IRUSR | stat.S_IWUSR)  # 600

    # Self-signed cert — 10 year validity
    now = datetime.now(timezone.utc)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, CA_COMMON_NAME),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, CA_COMMON_NAME),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print("[ca] Root CA generated successfully")


def _load_root_ca():
    """Return (ca_key, ca_cert) loaded from disk."""
    key_path  = CA_DATA / "ca.key"
    cert_path = CA_DATA / "ca.crt"

    with open(key_path, "rb") as f:
        ca_key = serialization.load_pem_private_key(f.read(), password=None)
    with open(cert_path, "rb") as f:
        ca_cert = x509.load_pem_x509_certificate(f.read())

    return ca_key, ca_cert


# ── Cert issuance ─────────────────────────────────────────────────────────────

async def _issue_cert(domain: str, sans: List[str], cert_type: str, pool: asyncpg.Pool) -> dict:
    """Issue a leaf cert signed by the root CA. Stores on disk and in DB."""
    ca_key, ca_cert = _load_root_ca()

    # RSA 2048 leaf key
    leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    # Build SAN list — domain is always first; add extras
    san_names: List[x509.GeneralName] = []
    all_names = [domain] + [s for s in sans if s and s != domain]

    for name in all_names:
        # Try to parse as IP first
        try:
            ip = ipaddress.ip_address(name)
            san_names.append(x509.IPAddress(ip))
        except ValueError:
            san_names.append(x509.DNSName(name))

    now    = datetime.now(timezone.utc)
    serial = x509.random_serial_number()

    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, domain),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(leaf_key.public_key())
        .serial_number(serial)
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=CERT_VALIDITY_DAYS))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([x509.ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .add_extension(x509.SubjectAlternativeName(san_names), critical=False)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )

    # Chain PEM: leaf first, then CA cert (browsers require this order)
    leaf_pem  = cert.public_bytes(serialization.Encoding.PEM)
    ca_pem    = (CA_DATA / "ca.crt").read_bytes()
    chain_pem = leaf_pem + ca_pem

    key_pem = leaf_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )

    # Persist to disk
    cert_dir = CA_DATA / "certs" / domain
    cert_dir.mkdir(parents=True, exist_ok=True)
    (cert_dir / "server.crt").write_bytes(chain_pem)
    (cert_dir / "server.key").write_bytes(key_pem)
    os.chmod(cert_dir / "server.key", stat.S_IRUSR | stat.S_IWUSR)

    not_before = cert.not_valid_before_utc
    not_after  = cert.not_valid_after_utc
    serial_hex = format(serial, 'x')

    # Upsert into DB
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO ca_issued_certs
                (domain, sans, cert_type, serial, not_before, not_after, revoked)
            VALUES ($1, $2, $3, $4, $5, $6, FALSE)
            ON CONFLICT (domain) DO UPDATE SET
                sans          = EXCLUDED.sans,
                cert_type     = EXCLUDED.cert_type,
                serial        = EXCLUDED.serial,
                not_before    = EXCLUDED.not_before,
                not_after     = EXCLUDED.not_after,
                npm_cert_id   = NULL,
                npm_pushed_at = NULL,
                push_error    = NULL,
                revoked       = FALSE
            RETURNING *
        """, domain, all_names, cert_type, serial_hex, not_before, not_after)

    print(f"[ca] Issued cert for {domain} (type={cert_type}, valid until {not_after.date()})")
    return dict(row)


# ── NPM push ──────────────────────────────────────────────────────────────────

async def _npm_token(session: aiohttp.ClientSession) -> str:
    """Fetch a fresh NPM bearer token."""
    async with session.post(
        f"{NPM_API_URL}/api/tokens",
        json={"identity": NPM_EMAIL, "secret": NPM_PASSWORD},
    ) as resp:
        data = await resp.json()
        if resp.status != 200:
            raise RuntimeError(f"NPM auth failed: {resp.status} {data}")
        return data["token"]


async def _npm_push_cert(domain: str, pool: asyncpg.Pool) -> dict:
    """
    Upload the cert for `domain` to NPM.

    On renewal: if a previous npm_cert_id exists, find proxy hosts using it,
    upload new cert, update those hosts to new cert_id, then delete old cert.
    """
    cert_dir = CA_DATA / "certs" / domain
    chain_pem = (cert_dir / "server.crt").read_text()
    key_pem   = (cert_dir / "server.key").read_text()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM ca_issued_certs WHERE domain = $1", domain
        )
    if not row:
        raise RuntimeError(f"No cert record found for domain: {domain}")

    old_cert_id = row["npm_cert_id"]
    all_names   = row["sans"] or [domain]

    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        token   = await _npm_token(session)
        headers = {"Authorization": f"Bearer {token}"}

        # Build multipart form
        form = aiohttp.FormData()
        form.add_field("nice_name", domain)
        for name in all_names:
            form.add_field("domain_names[]", name)
        form.add_field("certificate",     chain_pem, content_type="text/plain")
        form.add_field("certificate_key", key_pem,   content_type="text/plain")

        async with session.post(
            f"{NPM_API_URL}/api/nginx/certificates/custom",
            data=form,
            headers=headers,
        ) as resp:
            result = await resp.json()
            if resp.status not in (200, 201):
                raise RuntimeError(f"NPM cert upload failed: {resp.status} {result}")
            new_cert_id = result["id"]

        # If renewing, migrate proxy hosts from old cert to new, then delete old
        if old_cert_id and old_cert_id != new_cert_id:
            try:
                # Find proxy hosts using the old cert
                async with session.get(
                    f"{NPM_API_URL}/api/nginx/proxy-hosts",
                    headers=headers,
                ) as resp:
                    proxy_hosts = await resp.json()

                affected = [h for h in proxy_hosts if h.get("certificate_id") == old_cert_id]
                for ph in affected:
                    await session.put(
                        f"{NPM_API_URL}/api/nginx/proxy-hosts/{ph['id']}",
                        json={**ph, "certificate_id": new_cert_id},
                        headers=headers,
                    )
                    print(f"[ca] Updated proxy host {ph['id']} to new cert {new_cert_id}")

                # Delete old cert
                async with session.delete(
                    f"{NPM_API_URL}/api/nginx/certificates/{old_cert_id}",
                    headers=headers,
                ) as resp:
                    if resp.status not in (200, 204):
                        print(f"[ca] Warning: could not delete old cert {old_cert_id}: {resp.status}")
                    else:
                        print(f"[ca] Deleted old NPM cert {old_cert_id}")
            except Exception as e:
                print(f"[ca] Warning during migration of old cert {old_cert_id}: {e}")

    # Update DB
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE ca_issued_certs
            SET npm_cert_id = $1, npm_pushed_at = NOW(), push_error = NULL
            WHERE domain = $2
        """, new_cert_id, domain)

    print(f"[ca] Pushed cert for {domain} to NPM (cert_id={new_cert_id})")
    return {"npm_cert_id": new_cert_id}


# ── Renewal loop ──────────────────────────────────────────────────────────────

async def _renewal_loop():
    """Background task: check for expiring certs every 6 hours and renew them."""
    await asyncio.sleep(60)  # brief startup delay
    while True:
        try:
            pool = await get_pool()
            threshold = datetime.now(timezone.utc) + timedelta(days=RENEW_DAYS)
            async with pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT * FROM ca_issued_certs
                    WHERE revoked = FALSE
                      AND not_after <= $1
                """, threshold)

            for row in rows:
                domain    = row["domain"]
                sans      = list(row["sans"] or [])
                cert_type = row["cert_type"]
                try:
                    print(f"[ca] Auto-renewing cert for {domain}")
                    await _issue_cert(domain, [s for s in sans if s != domain], cert_type, pool)
                    if NPM_EMAIL and row["npm_cert_id"] is not None:
                        await _npm_push_cert(domain, pool)
                    elif NPM_EMAIL and row["npm_pushed_at"] is not None:
                        # Was pushed before but cert_id might be gone — try anyway
                        try:
                            await _npm_push_cert(domain, pool)
                        except Exception as e:
                            print(f"[ca] NPM push failed during renewal for {domain}: {e}")
                            async with pool.acquire() as conn:
                                await conn.execute(
                                    "UPDATE ca_issued_certs SET push_error = $1 WHERE domain = $2",
                                    str(e), domain,
                                )
                except Exception as e:
                    print(f"[ca] Renewal error for {domain}: {e}")

        except Exception as e:
            print(f"[ca] Renewal loop error: {e}")

        await asyncio.sleep(6 * 3600)


# ── Startup / shutdown ────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    pool = await get_pool()
    app.state.pool = pool
    await _ensure_schema(pool)
    _ensure_root_ca()
    asyncio.create_task(_renewal_loop())


@app.on_event("shutdown")
async def shutdown():
    if _pool:
        await _pool.close()


# ── Pydantic models ───────────────────────────────────────────────────────────

class IssueCertRequest(BaseModel):
    domain:       str
    sans:         List[str] = []
    cert_type:    str = "proxy"   # "proxy" | "container"
    push_to_npm:  bool = False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_dict(row) -> dict:
    d = dict(row)
    for k in ("not_before", "not_after", "npm_pushed_at", "created_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat()
    return d


def _days_left(row) -> Optional[int]:
    if not row.get("not_after"):
        return None
    try:
        dt = datetime.fromisoformat(str(row["not_after"])) if isinstance(row["not_after"], str) else row["not_after"]
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = dt - datetime.now(timezone.utc)
        return max(0, delta.days)
    except Exception:
        return None


# ── API endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/ca/root-cert")
async def download_root_cert():
    cert_path = CA_DATA / "ca.crt"
    if not cert_path.exists():
        raise HTTPException(503, "Root CA has not been generated yet")
    pem = cert_path.read_bytes()
    return Response(
        content=pem,
        media_type="application/x-pem-file",
        headers={"Content-Disposition": 'attachment; filename="ca.crt"'},
    )


@app.get("/api/ca/root-cert/info")
async def root_cert_info():
    cert_path = CA_DATA / "ca.crt"
    if not cert_path.exists():
        raise HTTPException(503, "Root CA has not been generated yet")

    with open(cert_path, "rb") as f:
        cert = x509.load_pem_x509_certificate(f.read())

    fingerprint = hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest()
    fp_formatted = ":".join(fingerprint[i:i+2].upper() for i in range(0, len(fingerprint), 2))

    try:
        cn = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
    except (IndexError, Exception):
        cn = CA_COMMON_NAME

    return {
        "common_name":        cn,
        "not_before":         cert.not_valid_before_utc.isoformat(),
        "not_after":          cert.not_valid_after_utc.isoformat(),
        "fingerprint_sha256": fp_formatted,
    }


@app.get("/api/ca/certs")
async def list_certs():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM ca_issued_certs ORDER BY created_at DESC")
    result = []
    for row in rows:
        d = _row_to_dict(row)
        d["days_left"] = _days_left(d)
        result.append(d)
    return result


@app.post("/api/ca/certs", status_code=201)
async def issue_cert(req: IssueCertRequest):
    domain = req.domain.strip()
    if not domain:
        raise HTTPException(400, "domain is required")
    if req.cert_type not in ("proxy", "container"):
        raise HTTPException(400, "cert_type must be 'proxy' or 'container'")

    pool = await get_pool()

    # Check not already revoked with same domain — allow re-issue
    npm_error = None
    row = await _issue_cert(domain, req.sans, req.cert_type, pool)

    if req.push_to_npm:
        if not NPM_EMAIL:
            npm_error = "NPM_API_EMAIL not configured"
        else:
            try:
                await _npm_push_cert(domain, pool)
                # Reload row with updated npm fields
                async with pool.acquire() as conn:
                    db_row = await conn.fetchrow(
                        "SELECT * FROM ca_issued_certs WHERE domain = $1", domain
                    )
                row = dict(db_row)
            except Exception as e:
                npm_error = str(e)
                async with pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE ca_issued_certs SET push_error = $1 WHERE domain = $2",
                        npm_error, domain,
                    )

    d = _row_to_dict(row)
    d["days_left"] = _days_left(d)
    if npm_error:
        d["npm_error"] = npm_error
    return d


@app.post("/api/ca/certs/{domain:path}/renew")
async def renew_cert(domain: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT * FROM ca_issued_certs WHERE domain = $1", domain
        )
    if not existing:
        raise HTTPException(404, f"No cert found for domain: {domain}")

    sans      = [s for s in (existing["sans"] or []) if s != domain]
    cert_type = existing["cert_type"]

    npm_error = None
    row = await _issue_cert(domain, sans, cert_type, pool)

    if NPM_EMAIL:
        try:
            await _npm_push_cert(domain, pool)
            async with pool.acquire() as conn:
                db_row = await conn.fetchrow(
                    "SELECT * FROM ca_issued_certs WHERE domain = $1", domain
                )
            row = dict(db_row)
        except Exception as e:
            npm_error = str(e)
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE ca_issued_certs SET push_error = $1 WHERE domain = $2",
                    npm_error, domain,
                )

    d = _row_to_dict(row)
    d["days_left"] = _days_left(d)
    if npm_error:
        d["npm_error"] = npm_error
    return d


@app.post("/api/ca/certs/{domain:path}/push-npm")
async def push_npm(domain: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT * FROM ca_issued_certs WHERE domain = $1", domain
        )
    if not existing:
        raise HTTPException(404, f"No cert found for domain: {domain}")
    if existing["revoked"]:
        raise HTTPException(400, "Cannot push a revoked cert")
    if not NPM_EMAIL:
        raise HTTPException(400, "NPM_API_EMAIL not configured")

    cert_dir = CA_DATA / "certs" / domain
    if not cert_dir.exists():
        raise HTTPException(409, "Cert files not found on disk — re-issue required")

    npm_error = None
    try:
        result = await _npm_push_cert(domain, pool)
        async with pool.acquire() as conn:
            db_row = await conn.fetchrow(
                "SELECT * FROM ca_issued_certs WHERE domain = $1", domain
            )
        d = _row_to_dict(dict(db_row))
        d["days_left"] = _days_left(d)
        return d
    except Exception as e:
        npm_error = str(e)
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE ca_issued_certs SET push_error = $1 WHERE domain = $2",
                npm_error, domain,
            )
        async with pool.acquire() as conn:
            db_row = await conn.fetchrow(
                "SELECT * FROM ca_issued_certs WHERE domain = $1", domain
            )
        d = _row_to_dict(dict(db_row))
        d["days_left"] = _days_left(d)
        d["npm_error"] = npm_error
        return d


@app.delete("/api/ca/certs/{domain:path}")
async def revoke_cert(domain: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT * FROM ca_issued_certs WHERE domain = $1", domain
        )
    if not existing:
        raise HTTPException(404, f"No cert found for domain: {domain}")

    npm_cert_id = existing["npm_cert_id"]

    # Delete from NPM if it was pushed
    if npm_cert_id and NPM_EMAIL:
        try:
            timeout = aiohttp.ClientTimeout(total=15)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                token = await _npm_token(session)
                async with session.delete(
                    f"{NPM_API_URL}/api/nginx/certificates/{npm_cert_id}",
                    headers={"Authorization": f"Bearer {token}"},
                ) as resp:
                    if resp.status not in (200, 204):
                        print(f"[ca] Warning: NPM delete cert {npm_cert_id} returned {resp.status}")
        except Exception as e:
            print(f"[ca] Warning: could not delete NPM cert {npm_cert_id}: {e}")

    # Delete files from disk
    cert_dir = CA_DATA / "certs" / domain
    if cert_dir.exists():
        for f in cert_dir.iterdir():
            f.unlink(missing_ok=True)
        try:
            cert_dir.rmdir()
        except OSError:
            pass  # not empty — leave it

    # Mark revoked in DB
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE ca_issued_certs
            SET revoked = TRUE, npm_cert_id = NULL, npm_pushed_at = NULL
            WHERE domain = $1
        """, domain)

    print(f"[ca] Revoked cert for {domain}")
    return {"ok": True, "domain": domain}


@app.get("/api/ca/certs/{domain:path}/download")
async def download_cert(domain: str):
    """Return a zip containing server.key and server.crt for the domain."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT * FROM ca_issued_certs WHERE domain = $1", domain
        )
    if not existing:
        raise HTTPException(404, f"No cert found for domain: {domain}")
    if existing["revoked"]:
        raise HTTPException(400, "Cert has been revoked")

    cert_dir = CA_DATA / "certs" / domain
    key_path  = cert_dir / "server.key"
    cert_path = cert_dir / "server.crt"

    if not key_path.exists() or not cert_path.exists():
        raise HTTPException(409, "Cert files not found on disk — re-issue required")

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("server.key", key_path.read_bytes())
        zf.writestr("server.crt", cert_path.read_bytes())
    buf.seek(0)

    safe_name = domain.replace("/", "_").replace("*", "wildcard")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}-cert.zip"'},
    )


# ── Internal endpoints (Docker-network only, no auth) ─────────────────────────
# These are NOT proxied through nginx (/api/ca/ is the only proxied prefix),
# so they are only reachable from containers on dashboard_net. Containers can
# call http://npm_ca:8007/internal/... directly to fetch their own cert files.

def _cert_files_or_404(domain: str):
    cert_dir  = CA_DATA / "certs" / domain
    key_path  = cert_dir / "server.key"
    cert_path = cert_dir / "server.crt"
    if not key_path.exists() or not cert_path.exists():
        raise HTTPException(404, "Cert files not found — issue a cert first")
    return key_path, cert_path


@app.get("/internal/certs/{domain:path}/cert")
async def internal_cert(domain: str):
    """Serve the certificate chain PEM (leaf + CA). No auth — internal network only."""
    _, cert_path = _cert_files_or_404(domain)
    return Response(cert_path.read_bytes(), media_type="application/x-pem-file",
                    headers={"Content-Disposition": f'inline; filename="server.crt"'})


@app.get("/internal/certs/{domain:path}/key")
async def internal_key(domain: str):
    """Serve the private key PEM. No auth — internal network only."""
    key_path, _ = _cert_files_or_404(domain)
    return Response(key_path.read_bytes(), media_type="application/x-pem-file",
                    headers={"Content-Disposition": f'inline; filename="server.key"'})


@app.get("/internal/ca/root-cert")
async def internal_root_cert():
    """Serve the root CA certificate PEM. No auth — internal network only."""
    ca_cert = CA_DATA / "ca.crt"
    if not ca_cert.exists():
        raise HTTPException(503, "Root CA not yet initialised")
    return Response(ca_cert.read_bytes(), media_type="application/x-pem-file",
                    headers={"Content-Disposition": 'inline; filename="ca.crt"'})


@app.get("/internal/certs/{domain:path}/install.sh")
async def install_script(domain: str):
    """
    Return a shell script that fetches this cert+key from the CA service and
    installs them inside the calling container. Designed to be piped to sh:

        curl -s http://npm_ca:8007/internal/certs/<domain>/install.sh | sh

    The script:
    - Downloads cert, key, and root CA from this service
    - Places them under /etc/ssl/ca/ (or $CERT_DIR if set)
    - Trusts the root CA system-wide (Debian/Alpine/RHEL auto-detected)
    - Prints the final paths so the calling app knows where to find them
    """
    # Verify cert exists before returning a script
    _cert_files_or_404(domain)

    ca_url = "http://npm_ca:8007"
    script = f"""#!/bin/sh
set -e

CA_URL="{ca_url}"
DOMAIN="{domain}"
CERT_DIR="${{CERT_DIR:-/etc/ssl/ca}}"

echo "[ca-install] Installing cert for $DOMAIN from $CA_URL"

mkdir -p "$CERT_DIR"

curl -sf "$CA_URL/internal/certs/$DOMAIN/cert" -o "$CERT_DIR/server.crt"
curl -sf "$CA_URL/internal/certs/$DOMAIN/key"  -o "$CERT_DIR/server.key"
curl -sf "$CA_URL/internal/ca/root-cert"        -o "$CERT_DIR/ca.crt"

chmod 600 "$CERT_DIR/server.key"
chmod 644 "$CERT_DIR/server.crt" "$CERT_DIR/ca.crt"

echo "[ca-install] Cert:    $CERT_DIR/server.crt"
echo "[ca-install] Key:     $CERT_DIR/server.key"
echo "[ca-install] Root CA: $CERT_DIR/ca.crt"

# ── Trust root CA system-wide ────────────────────────────────────────────────
if command -v update-ca-certificates >/dev/null 2>&1; then
    # Debian / Ubuntu / Alpine (ca-certificates package)
    if [ -d /usr/local/share/ca-certificates ]; then
        cp "$CERT_DIR/ca.crt" /usr/local/share/ca-certificates/internal-ca.crt
        update-ca-certificates --fresh >/dev/null 2>&1 || true
        echo "[ca-install] Trusted root CA (Debian/Ubuntu)"
    fi
elif command -v update-ca-trust >/dev/null 2>&1; then
    # RHEL / CentOS / Fedora
    cp "$CERT_DIR/ca.crt" /etc/pki/ca-trust/source/anchors/internal-ca.crt
    update-ca-trust extract >/dev/null 2>&1 || true
    echo "[ca-install] Trusted root CA (RHEL/CentOS)"
else
    echo "[ca-install] WARNING: could not auto-trust root CA — add $CERT_DIR/ca.crt to your trust store manually"
fi

echo "[ca-install] Done."
"""
    return Response(script, media_type="text/plain",
                    headers={"Content-Disposition": f'inline; filename="install.sh"'})
