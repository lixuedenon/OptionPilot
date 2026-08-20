/*
# Create user data tables for cross-device sync

1. New Tables
- `saved_strategies`: Stores option strategy combinations saved by users.
  - `id` (text, primary key) — client-generated unique ID
  - `user_id` (uuid, not null, defaults to auth.uid()) — owner
  - `filename` (text) — user-visible name
  - `symbol` (text) — stock ticker
  - `spot` (numeric) — stock price at save time
  - `legs` (jsonb) — array of leg objects
  - `shifts` (jsonb) — shift parameters
  - `opening_at` (bigint) — opening timestamp (ms epoch)
  - `starred` (boolean, default false)
  - `tracking` (boolean, default false)
  - `tracked_snapshots` (jsonb) — array of tracked snapshot objects
  - `created_at` (bigint) — creation timestamp (ms epoch)
  - `updated_at` (bigint) — last modification timestamp (ms epoch)

- `custom_presets`: Stores user-created strategy presets.
  - `id` (text, primary key) — client-generated unique ID
  - `user_id` (uuid, not null, defaults to auth.uid()) — owner
  - `name` (text)
  - `description` (text)
  - `market` (text)
  - `stocks` (text)
  - `direction` (text)
  - `legs` (jsonb) — array of leg objects
  - `created_at` (bigint) — creation timestamp (ms epoch)

- `recent_symbols`: Stores recently used stock tickers per user.
  - `id` (uuid, primary key, default gen_random_uuid())
  - `user_id` (uuid, not null, defaults to auth.uid()) — owner
  - `symbol` (text, not null)
  - `created_at` (timestamptz, default now())
  - Unique constraint on (user_id, symbol) to prevent duplicates

2. Security
- Enable RLS on all three tables.
- Owner-scoped CRUD: each authenticated user can only access their own rows.
- All tables use `user_id uuid NOT NULL DEFAULT auth.uid()` so inserts omitting user_id succeed.
*/

CREATE TABLE IF NOT EXISTS saved_strategies (
  id text PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  filename text NOT NULL DEFAULT '',
  symbol text NOT NULL DEFAULT '',
  spot numeric NOT NULL DEFAULT 0,
  legs jsonb NOT NULL DEFAULT '[]',
  shifts jsonb NOT NULL DEFAULT '{}',
  opening_at bigint,
  starred boolean NOT NULL DEFAULT false,
  tracking boolean NOT NULL DEFAULT false,
  tracked_snapshots jsonb NOT NULL DEFAULT '[]',
  created_at bigint NOT NULL DEFAULT 0,
  updated_at bigint NOT NULL DEFAULT 0
);

ALTER TABLE saved_strategies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_strategies" ON saved_strategies;
CREATE POLICY "select_own_strategies" ON saved_strategies FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_strategies" ON saved_strategies;
CREATE POLICY "insert_own_strategies" ON saved_strategies FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_strategies" ON saved_strategies;
CREATE POLICY "update_own_strategies" ON saved_strategies FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_strategies" ON saved_strategies;
CREATE POLICY "delete_own_strategies" ON saved_strategies FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS custom_presets (
  id text PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  market text NOT NULL DEFAULT '',
  stocks text NOT NULL DEFAULT '',
  direction text NOT NULL DEFAULT '',
  legs jsonb NOT NULL DEFAULT '[]',
  created_at bigint NOT NULL DEFAULT 0
);

ALTER TABLE custom_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_presets" ON custom_presets;
CREATE POLICY "select_own_presets" ON custom_presets FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_presets" ON custom_presets;
CREATE POLICY "insert_own_presets" ON custom_presets FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_presets" ON custom_presets;
CREATE POLICY "update_own_presets" ON custom_presets FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_presets" ON custom_presets;
CREATE POLICY "delete_own_presets" ON custom_presets FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS recent_symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, symbol)
);

ALTER TABLE recent_symbols ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_symbols" ON recent_symbols;
CREATE POLICY "select_own_symbols" ON recent_symbols FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_symbols" ON recent_symbols;
CREATE POLICY "insert_own_symbols" ON recent_symbols FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_symbols" ON recent_symbols;
CREATE POLICY "delete_own_symbols" ON recent_symbols FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
