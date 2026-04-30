export const STORAGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS aw_users (
  user_id BIGINT PRIMARY KEY,
  full_name TEXT,
  username TEXT,
  email TEXT,
  phone_number TEXT,
  roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  account_state TEXT,
  provider_status TEXT,
  subscriber_active BOOLEAN NOT NULL DEFAULT FALSE,
  next_billing_date TIMESTAMPTZ NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aw_subscriber_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES aw_users(user_id) ON DELETE CASCADE,
  membership_price NUMERIC NULL,
  vehicle JSONB NULL,
  saved_vehicles JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_info JSONB NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aw_provider_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES aw_users(user_id) ON DELETE CASCADE,
  service_area TEXT NULL,
  current_location TEXT NULL,
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  rating JSONB NOT NULL DEFAULT '{}'::jsonb,
  discipline JSONB NOT NULL DEFAULT '{}'::jsonb,
  wallet JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aw_service_requests (
  request_id TEXT PRIMARY KEY,
  user_id BIGINT NULL,
  assigned_provider_id BIGINT NULL,
  status TEXT NULL,
  completion_status TEXT NULL,
  payment_status TEXT NULL,
  provider_payout_status TEXT NULL,
  service_type TEXT NULL,
  submitted_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS aw_payment_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NULL,
  request_id TEXT NULL,
  paypal_order_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS aw_provider_wallet_history (
  entry_id TEXT PRIMARY KEY,
  provider_user_id BIGINT NULL,
  request_id TEXT NULL,
  provider_payout_status TEXT NULL,
  payout_reference TEXT NULL,
  amount_collected NUMERIC NULL,
  provider_payout_amount NUMERIC NULL,
  completed_at TIMESTAMPTZ NULL,
  payout_completed_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aw_provider_performance_history (
  history_id TEXT PRIMARY KEY,
  provider_user_id BIGINT NOT NULL,
  category TEXT NOT NULL,
  event_reference TEXT NULL,
  occurred_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
