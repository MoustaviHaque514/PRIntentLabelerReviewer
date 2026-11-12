CREATE TABLE IF NOT EXISTS expert_llm_configurations (
  installation_id BIGINT NOT NULL CHECK (installation_id > 0),
  intention VARCHAR(64) NOT NULL CHECK (intention ~ '^[a-z][a-z0-9_-]*$'),
  provider VARCHAR(32) NOT NULL CHECK (
    provider IN ('anthropic', 'openai', 'gemini')
  ),
  model TEXT NOT NULL CHECK (length(btrim(model)) > 0),
  encrypted_api_key TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_auth_tag TEXT NOT NULL,
  key_last_four VARCHAR(4) NOT NULL,
  base_url TEXT,
  created_by_github_user_id BIGINT NOT NULL,
  updated_by_github_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (installation_id, intention)
);

CREATE TABLE IF NOT EXISTS expert_llm_configuration_audits (
  id BIGSERIAL PRIMARY KEY,
  installation_id BIGINT NOT NULL,
  intention VARCHAR(64) NOT NULL,
  action VARCHAR(16) NOT NULL CHECK (
    action IN ('created', 'updated', 'deleted')
  ),
  provider VARCHAR(32),
  model TEXT,
  github_user_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expert_llm_configuration_audits_scope_idx
  ON expert_llm_configuration_audits (installation_id, intention, created_at DESC);
