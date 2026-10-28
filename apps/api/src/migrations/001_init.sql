-- GoldScope AI initial schema
CREATE TABLE IF NOT EXISTS market_data_sources (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  provider          TEXT NOT NULL,
  symbol            TEXT NOT NULL,
  timeframe         TEXT NOT NULL,
  timezone          TEXT NOT NULL DEFAULT 'Africa/Casablanca',
  is_active         BOOLEAN NOT NULL DEFAULT FALSE,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_configs (
  id                        SERIAL PRIMARY KEY,
  version                   INTEGER NOT NULL,
  is_active                 BOOLEAN NOT NULL DEFAULT FALSE,
  symbol                    TEXT NOT NULL DEFAULT 'XAU/USD',
  timeframe                 TEXT NOT NULL DEFAULT '1h',
  timezone                  TEXT NOT NULL DEFAULT 'Africa/Casablanca',
  session_start             TEXT NOT NULL DEFAULT '00:00',
  session_end               TEXT NOT NULL DEFAULT '23:59',
  profile_lookback_days     INTEGER NOT NULL DEFAULT 1,
  value_area_percent        NUMERIC(6,3) NOT NULL DEFAULT 70,
  bin_size                  NUMERIC(12,5),
  retest_window_candles     INTEGER NOT NULL DEFAULT 6,
  retest_zone_ticks         NUMERIC(12,5) NOT NULL DEFAULT 0.10,
  retest_zone_atr_fraction  NUMERIC(12,5) NOT NULL DEFAULT 0.25,
  atr_period                INTEGER NOT NULL DEFAULT 14,
  atr_fallback_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  stop_buffer_ticks         NUMERIC(12,5) NOT NULL DEFAULT 0.05,
  stop_buffer_atr_fraction  NUMERIC(12,5) NOT NULL DEFAULT 0.10,
  max_stop_atr              NUMERIC(12,5) NOT NULL DEFAULT 2.5,
  min_stop_ticks            NUMERIC(12,5) NOT NULL DEFAULT 0.10,
  rr_target1                NUMERIC(12,5) NOT NULL DEFAULT 1.5,
  rr_target2                NUMERIC(12,5) NOT NULL DEFAULT 3.0,
  min_risk_reward           NUMERIC(12,5) NOT NULL DEFAULT 1.0,
  entry_type                TEXT NOT NULL DEFAULT 'confirmation_close',
  price_precision           INTEGER NOT NULL DEFAULT 2,
  tick_size                 NUMERIC(12,5) NOT NULL DEFAULT 0.01,
  risk_per_trade_percent    NUMERIC(6,3),
  max_signal_age_minutes    INTEGER NOT NULL DEFAULT 240,
  notes                     TEXT NOT NULL DEFAULT '',
  changed_by                TEXT NOT NULL DEFAULT 'system',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS strategy_configs_version_idx ON strategy_configs (version);
CREATE INDEX IF NOT EXISTS strategy_configs_active_idx ON strategy_configs (is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS signals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_key               TEXT NOT NULL UNIQUE,
  direction                TEXT NOT NULL CHECK (direction IN ('BUY','SELL')),
  status                   TEXT NOT NULL CHECK (status IN ('OPEN','TARGET_HIT','STOP_HIT','INVALIDATED','EXPIRED','UNRESOLVED')),
  instrument               TEXT NOT NULL,
  timeframe                TEXT NOT NULL,
  entry                    NUMERIC(14,5) NOT NULL,
  observed_price           NUMERIC(14,5) NOT NULL,
  stop_loss                NUMERIC(14,5) NOT NULL,
  tp1                      NUMERIC(14,5) NOT NULL,
  tp2                      NUMERIC(14,5) NOT NULL,
  risk_reward1             NUMERIC(12,5) NOT NULL,
  risk_reward2             NUMERIC(12,5) NOT NULL,
  atr                      NUMERIC(14,5),
  atr_period               INTEGER,
  profile_range_start      TIMESTAMPTZ NOT NULL,
  profile_range_end        TIMESTAMPTZ NOT NULL,
  poc                      NUMERIC(14,5),
  vah                      NUMERIC(14,5),
  val                      NUMERIC(14,5),
  breakout_candle_time     TIMESTAMPTZ,
  retest_candle_time       TIMESTAMPTZ,
  confirmation_candle_time TIMESTAMPTZ,
  reason                   TEXT NOT NULL,
  invalidated_reason       TEXT,
  result_price             NUMERIC(14,5),
  realized_r               NUMERIC(12,5),
  closed_at                TIMESTAMPTZ,
  source                   TEXT NOT NULL DEFAULT 'forward' CHECK (source IN ('forward','backtest')),
  evidence                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS signals_created_idx ON signals (created_at DESC);
CREATE INDEX IF NOT EXISTS signals_direction_idx ON signals (direction);
CREATE INDEX IF NOT EXISTS signals_status_idx ON signals (status);
CREATE INDEX IF NOT EXISTS signals_source_idx ON signals (source);
CREATE INDEX IF NOT EXISTS signals_timeframe_idx ON signals (timeframe);

CREATE TABLE IF NOT EXISTS signal_events (
  id          BIGSERIAL PRIMARY KEY,
  signal_id   UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS signal_events_signal_idx ON signal_events (signal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label                TEXT NOT NULL,
  symbol               TEXT NOT NULL,
  timeframe            TEXT NOT NULL,
  range_start          TIMESTAMPTZ NOT NULL,
  range_end            TIMESTAMPTZ NOT NULL,
  sample_size          INTEGER NOT NULL,
  trades               INTEGER NOT NULL DEFAULT 0,
  wins                 INTEGER NOT NULL DEFAULT 0,
  losses               INTEGER NOT NULL DEFAULT 0,
  unresolved           INTEGER NOT NULL DEFAULT 0,
  win_rate             NUMERIC(10,5),
  average_r            NUMERIC(12,5),
  expectancy           NUMERIC(12,5),
  max_drawdown_r       NUMERIC(12,5),
  total_fees           NUMERIC(16,6) NOT NULL DEFAULT 0,
  spread_assumption    NUMERIC(12,5) NOT NULL DEFAULT 0,
  slippage_assumption  NUMERIC(12,5) NOT NULL DEFAULT 0,
  in_sample            BOOLEAN NOT NULL DEFAULT FALSE,
  notes                JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS backtest_runs_generated_idx ON backtest_runs (generated_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id          SERIAL PRIMARY KEY,
  channel     TEXT NOT NULL UNIQUE,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id          BIGSERIAL PRIMARY KEY,
  signal_id   UUID REFERENCES signals(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  error       TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (signal_id, channel)
);
CREATE INDEX IF NOT EXISTS notification_deliveries_created_idx ON notification_deliveries (created_at DESC);

CREATE TABLE IF NOT EXISTS system_health_events (
  id          BIGSERIAL PRIMARY KEY,
  component   TEXT NOT NULL,
  status      TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS system_health_events_created_idx ON system_health_events (created_at DESC);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id            BIGSERIAL PRIMARY KEY,
  status        TEXT NOT NULL,
  trigger       TEXT NOT NULL DEFAULT 'scheduler',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  duration_ms   INTEGER,
  candles       INTEGER DEFAULT 0,
  decision      TEXT,
  signal_id     UUID,
  error         TEXT,
  provider      TEXT
);
CREATE INDEX IF NOT EXISTS analysis_runs_started_idx ON analysis_runs (started_at DESC);
