-- Extra performance indexes
CREATE INDEX IF NOT EXISTS signals_open_idx ON signals (created_at DESC) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS signals_source_status_idx ON signals (source, status);
CREATE INDEX IF NOT EXISTS analysis_runs_status_idx ON analysis_runs (status);
