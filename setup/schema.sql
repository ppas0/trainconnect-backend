-- TrainConnect Europe – PostgreSQL Schema
-- Ausführen mit: psql $DATABASE_URL -f setup/schema.sql
-- Oder über: node setup/migrate.js

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 VARCHAR(255) UNIQUE NOT NULL,
  password_hash         VARCHAR(255) NOT NULL,
  name                  VARCHAR(255) NOT NULL,
  role                  VARCHAR(20)  NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  loyalty_points        INTEGER      NOT NULL DEFAULT 0,
  password_reset_token  VARCHAR(255),
  password_reset_expiry TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── Tickets ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code      VARCHAR(20)   NOT NULL UNIQUE,
  user_id          UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_station     VARCHAR(255)  NOT NULL,
  from_id          VARCHAR(10)   NOT NULL,
  to_station       VARCHAR(255)  NOT NULL,
  to_id            VARCHAR(10)   NOT NULL,
  departure_time   TIMESTAMPTZ   NOT NULL,
  arrival_time     TIMESTAMPTZ   NOT NULL,
  train_number     VARCHAR(50),
  operator         VARCHAR(100),
  seat_class       CHAR(1)       NOT NULL DEFAULT '2',
  passengers       SMALLINT      NOT NULL DEFAULT 1,
  price            NUMERIC(10,2) NOT NULL,
  currency         CHAR(3)       NOT NULL DEFAULT 'EUR',
  status           VARCHAR(20)   NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','used')),
  payment_method   VARCHAR(50),
  payment_id       VARCHAR(255),
  changes          SMALLINT      NOT NULL DEFAULT 0,
  duration         VARCHAR(50),
  amenities        JSONB         NOT NULL DEFAULT '[]',
  price_breakdown  JSONB,
  tracking_events  JSONB         NOT NULL DEFAULT '[]',
  seat_number      VARCHAR(10),
  cancelled_at     TIMESTAMPTZ,
  refund_amount    NUMERIC(10,2),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user_id   ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status     ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);

-- ── Price Alerts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_id      VARCHAR(10)   NOT NULL,
  to_id        VARCHAR(10)   NOT NULL,
  from_name    VARCHAR(255),
  to_name      VARCHAR(255),
  target_price NUMERIC(10,2) NOT NULL,
  active       BOOLEAN       NOT NULL DEFAULT TRUE,
  triggered_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON price_alerts(user_id);

-- ── Error Logs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS error_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       VARCHAR(100),
  message    TEXT,
  context    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_errors_created_at ON error_logs(created_at DESC);

-- Tabellen werden automatisch ältere Einträge bereinigt (optional: pg_cron-Job)
