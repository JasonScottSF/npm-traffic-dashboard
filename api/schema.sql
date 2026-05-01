CREATE TABLE IF NOT EXISTS requests (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    host VARCHAR(255),
    client_ip INET,
    method VARCHAR(10),
    path TEXT,
    status_code SMALLINT,
    bytes_sent BIGINT DEFAULT 0,
    referer TEXT,
    user_agent TEXT,
    country_code CHAR(2),
    is_bot BOOLEAN DEFAULT FALSE,
    browser VARCHAR(64),
    os VARCHAR(64),
    device_type VARCHAR(16),   -- desktop | mobile | tablet | bot
    response_time_ms FLOAT,    -- populated if $request_time is in log format
    session_id BIGINT          -- filled by session materializer
);

CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    host VARCHAR(255),
    client_ip INET,
    user_agent_hash BIGINT,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    page_count INT DEFAULT 1,
    total_bytes BIGINT DEFAULT 0,
    country_code CHAR(2),
    browser VARCHAR(64),
    os VARCHAR(64),
    device_type VARCHAR(16),
    is_bot BOOLEAN DEFAULT FALSE,
    bounced BOOLEAN DEFAULT TRUE,   -- true if page_count = 1
    duration_seconds INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests (ts DESC);
CREATE INDEX IF NOT EXISTS idx_requests_host_ts ON requests (host, ts DESC);
CREATE INDEX IF NOT EXISTS idx_requests_ip_ts ON requests (client_ip, ts DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (status_code, ts DESC);
CREATE INDEX IF NOT EXISTS idx_requests_country ON requests (country_code, ts DESC);
CREATE INDEX IF NOT EXISTS idx_requests_session ON requests (session_id);

CREATE INDEX IF NOT EXISTS idx_sessions_ts ON sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_host ON sessions (host, started_at DESC);

CREATE TABLE IF NOT EXISTS system_upgrades (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    exit_code   INT NOT NULL DEFAULT 0,
    packages    TEXT,
    stdout      TEXT,
    duration_s  INT
);
