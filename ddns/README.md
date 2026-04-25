# DDNS Updater — Route53

Queries Nginx Proxy Manager for all configured proxy host domains and upserts Route53 A records whenever your external IP changes. Runs as a standalone Docker container separate from the main dashboard stack.

---

## How it works

1. Calls the NPM API to get the list of all proxy hosts
2. Checks your current external IP (via `checkip.amazonaws.com`)
3. For each domain, reads the current Route53 A record — skips it if the IP already matches
4. Updates any records that are stale
5. Sleeps 5 minutes and repeats

Wildcard domains (e.g. `*.example.com`) are skipped automatically.

---

## IAM setup

Create a dedicated IAM user — do not use your root or personal credentials.

### 1. Create the user

AWS Console → **IAM → Users → Create user**
- Name: `ddns-updater`
- Access type: no console access needed

### 2. Attach an inline policy

On the user's Permissions tab → **Add permissions → Create inline policy → JSON**

Paste this exactly:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets"
      ],
      "Resource": "arn:aws:route53:::hostedzone/Z3IKZ3F0ZCKPBK"
    }
  ]
}
```

Name the policy `ddns-route53`.

### 3. Create an access key

User → **Security credentials → Create access key**
- Use case: *Application running outside AWS*
- Download or copy the **Access key ID** and **Secret access key** — you won't see the secret again

---

## Setup

```bash
cp .env.example .env
nano .env
```

Fill in:

| Variable | Value |
|----------|-------|
| `NPM_URL` | URL of your NPM admin UI, e.g. `http://192.168.1.10:81` |
| `NPM_EMAIL` | NPM admin email |
| `NPM_PASSWORD` | NPM admin password |
| `DDNS_HOSTED_ZONE_ID` | `Z3IKZ3F0ZCKPBK` |
| `AWS_ACCESS_KEY_ID` | From the access key you just created |
| `AWS_SECRET_ACCESS_KEY` | From the access key you just created |
| `DDNS_INTERVAL` | Seconds between checks (default `300` = 5 min) |
| `DDNS_TTL` | DNS record TTL in seconds (default `60`) |

---

## Run

```bash
docker compose up -d
```

### View logs

```bash
docker logs -f ddns_route53
```

Example output:
```
2026-04-25 10:00:00 [ddns] DDNS updater starting — zone=Z3IKZ3F0ZCKPBK interval=300s ttl=60s
2026-04-25 10:00:01 [ddns] External IP: 99.122.53.231
2026-04-25 10:00:01 [ddns] Discovered 4 domain(s): app.jasonscott.us, dash.jasonscott.us, git.jasonscott.us, home.jasonscott.us
2026-04-25 10:00:02 [ddns]   Updated app.jasonscott.us: (new) → 99.122.53.231
2026-04-25 10:00:02 [ddns]   Updated dash.jasonscott.us: (new) → 99.122.53.231
2026-04-25 10:00:02 [ddns] Done. updated=4 skipped=0 failed=0
```

### Stop

```bash
docker compose down
```
