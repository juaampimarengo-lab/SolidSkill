import type { Migration } from '../migrator'

/**
 * 001 — initial core schema. See docs/DATABASE_SCHEMA.md for the rationale
 * behind every table, constraint, and trigger.
 *
 * Conventions:
 *  - STRICT tables; ids are opaque TEXT (UUID v4) owned by Solid Skill.
 *  - Timestamps are INTEGER milliseconds since the Unix epoch (UTC).
 *  - Analytical dates are TEXT 'YYYY-MM-DD'.
 *  - Financial values are INTEGER fixed-point, scale 10^-8 (see fixedPoint.ts).
 *  - Foreign keys are RESTRICT (SQLite default NO ACTION): nothing cascades.
 */
export const migration001: Migration = {
  version: 1,
  name: 'initial_core',
  sql: `
CREATE TABLE accounts (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL CHECK (length(display_name) > 0),
  source_platform   TEXT NOT NULL CHECK (length(source_platform) > 0),
  source_account_id TEXT CHECK (source_account_id IS NULL OR length(source_account_id) > 0),
  currency          TEXT NOT NULL CHECK (length(currency) > 0),
  timezone          TEXT,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  archived_at       INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
  UNIQUE (id, source_platform)
) STRICT;

CREATE UNIQUE INDEX accounts_source_identity
  ON accounts (source_platform, source_account_id)
  WHERE source_account_id IS NOT NULL;

CREATE TABLE strategies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) > 0),
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  archived_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
) STRICT;

-- One row per Draft or Published Version. A Draft is a DRAFT row; publishing
-- flips that same row to PUBLISHED and assigns the next sequential number.
CREATE TABLE strategy_versions (
  id              TEXT PRIMARY KEY,
  strategy_id     TEXT NOT NULL REFERENCES strategies (id),
  state           TEXT NOT NULL CHECK (state IN ('DRAFT', 'PUBLISHED')),
  version_number  INTEGER CHECK (version_number IS NULL OR version_number >= 1),
  base_version_id TEXT REFERENCES strategy_versions (id),
  published_at    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  CHECK (
    (state = 'DRAFT'     AND version_number IS NULL     AND published_at IS NULL) OR
    (state = 'PUBLISHED' AND version_number IS NOT NULL AND published_at IS NOT NULL)
  ),
  UNIQUE (strategy_id, version_number)
) STRICT;

-- At most one Draft per Strategy.
CREATE UNIQUE INDEX strategy_versions_one_draft
  ON strategy_versions (strategy_id)
  WHERE state = 'DRAFT';

CREATE TABLE rule_groups (
  id                  TEXT PRIMARY KEY,
  strategy_version_id TEXT NOT NULL REFERENCES strategy_versions (id),
  name                TEXT NOT NULL CHECK (length(name) > 0),
  description         TEXT NOT NULL DEFAULT '',
  position            INTEGER NOT NULL CHECK (position >= 0),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (strategy_version_id, id)
) STRICT;

CREATE INDEX rule_groups_by_version ON rule_groups (strategy_version_id, position);

-- strategy_version_id is repeated here so that composite foreign keys can
-- prove a rule belongs to the same version as its group and its evaluations.
CREATE TABLE rules (
  id                  TEXT PRIMARY KEY,
  strategy_version_id TEXT NOT NULL REFERENCES strategy_versions (id),
  rule_group_id       TEXT NOT NULL,
  title               TEXT NOT NULL CHECK (length(title) > 0),
  description         TEXT NOT NULL DEFAULT '',
  kind                TEXT NOT NULL CHECK (kind IN ('REQUIRED', 'OPTIONAL', 'CONDITIONAL')),
  position            INTEGER NOT NULL CHECK (position >= 0),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  FOREIGN KEY (strategy_version_id, rule_group_id)
    REFERENCES rule_groups (strategy_version_id, id),
  UNIQUE (strategy_version_id, id)
) STRICT;

CREATE INDEX rules_by_group ON rules (rule_group_id, position);

CREATE TABLE trades (
  id                     TEXT PRIMARY KEY,
  account_id             TEXT NOT NULL,
  source_platform        TEXT NOT NULL,
  source_trade_id        TEXT CHECK (source_trade_id IS NULL OR length(source_trade_id) > 0),
  source_position_id     TEXT CHECK (source_position_id IS NULL OR length(source_position_id) > 0),
  analytical_trade_date  TEXT NOT NULL
    CHECK (analytical_trade_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  instrument             TEXT NOT NULL CHECK (length(instrument) > 0),
  direction              TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  quantity               INTEGER NOT NULL CHECK (quantity > 0),
  opened_at              INTEGER NOT NULL,
  closed_at              INTEGER,
  avg_entry_price        INTEGER NOT NULL,
  avg_exit_price         INTEGER,
  gross_pnl              INTEGER,
  -- Cost categories are separate, signed (a cost is negative) and nullable:
  -- NULL = not reported / not applicable, never an invented zero.
  -- Invariant (repository-checked when gross and net are both present):
  --   net_pnl = gross_pnl + commission + fees + swap   (NULL counts as 0)
  commission             INTEGER,
  fees                   INTEGER,
  swap                   INTEGER,
  net_pnl                INTEGER,
  planned_r              INTEGER,
  realized_r             INTEGER,
  strategy_version_id    TEXT REFERENCES strategy_versions (id),
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  CHECK (closed_at IS NULL OR closed_at >= opened_at),
  FOREIGN KEY (account_id, source_platform) REFERENCES accounts (id, source_platform),
  UNIQUE (id, account_id),
  UNIQUE (id, strategy_version_id)
) STRICT;

CREATE INDEX trades_by_account_date ON trades (account_id, analytical_trade_date);
CREATE INDEX trades_by_strategy_version ON trades (strategy_version_id);
CREATE INDEX trades_by_source_position
  ON trades (source_platform, account_id, source_position_id)
  WHERE source_position_id IS NOT NULL;
CREATE INDEX trades_by_source_trade
  ON trades (source_platform, account_id, source_trade_id)
  WHERE source_trade_id IS NOT NULL;

CREATE TABLE executions (
  id                  TEXT PRIMARY KEY,
  trade_id            TEXT NOT NULL,
  account_id          TEXT NOT NULL,
  source_platform     TEXT NOT NULL,
  source_execution_id TEXT CHECK (source_execution_id IS NULL OR length(source_execution_id) > 0),
  source_position_id  TEXT CHECK (source_position_id IS NULL OR length(source_position_id) > 0),
  executed_at         INTEGER NOT NULL,
  side                TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  price               INTEGER NOT NULL,
  -- Per-execution costs are optional: a source may supply only trade-level
  -- totals. Same sign convention as trades; NULL = not reported.
  commission          INTEGER,
  fees                INTEGER,
  swap                INTEGER,
  created_at          INTEGER NOT NULL,
  FOREIGN KEY (trade_id, account_id) REFERENCES trades (id, account_id),
  FOREIGN KEY (account_id, source_platform) REFERENCES accounts (id, source_platform)
) STRICT;

CREATE INDEX executions_by_trade ON executions (trade_id, executed_at);
CREATE INDEX executions_by_source_position
  ON executions (source_platform, account_id, source_position_id)
  WHERE source_position_id IS NOT NULL;

-- Ingestion dedup: the same source execution can exist only once.
CREATE UNIQUE INDEX executions_source_identity
  ON executions (source_platform, account_id, source_execution_id)
  WHERE source_execution_id IS NOT NULL;

-- A Trade Rule Evaluation is bound to (trade, version, rule). The composite
-- foreign keys prove that (a) the version is the one the trade is associated
-- with and (b) the rule belongs to exactly that version. Nothing here reads
-- "the current version of the strategy".
CREATE TABLE trade_rule_evaluations (
  id                  TEXT PRIMARY KEY,
  trade_id            TEXT NOT NULL,
  strategy_version_id TEXT NOT NULL,
  rule_id             TEXT NOT NULL,
  state               TEXT NOT NULL CHECK (state IN ('PASS', 'FAIL', 'N/A', 'UNREVIEWED')),
  evaluated_at        INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  CHECK ((state = 'UNREVIEWED') = (evaluated_at IS NULL)),
  FOREIGN KEY (trade_id, strategy_version_id) REFERENCES trades (id, strategy_version_id),
  FOREIGN KEY (strategy_version_id, rule_id) REFERENCES rules (strategy_version_id, id),
  UNIQUE (trade_id, rule_id)
) STRICT;

CREATE INDEX trade_rule_evaluations_by_rule ON trade_rule_evaluations (rule_id, state);

CREATE TABLE trade_notes (
  trade_id   TEXT PRIMARY KEY REFERENCES trades (id),
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE day_notes (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  trade_date TEXT NOT NULL CHECK (trade_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, trade_date)
) STRICT;

-- ---------------------------------------------------------------------------
-- Immutability guards (defense in depth beneath the repository layer).
-- ---------------------------------------------------------------------------

-- A Published Version row never changes and is never deleted.
CREATE TRIGGER strategy_versions_published_no_update
BEFORE UPDATE ON strategy_versions
WHEN OLD.state = 'PUBLISHED'
BEGIN
  SELECT RAISE(ABORT, 'published strategy versions are immutable');
END;

CREATE TRIGGER strategy_versions_published_no_delete
BEFORE DELETE ON strategy_versions
WHEN OLD.state = 'PUBLISHED'
BEGIN
  SELECT RAISE(ABORT, 'published strategy versions cannot be deleted');
END;

-- Identity and lineage of a Draft are fixed; only its state may advance.
CREATE TRIGGER strategy_versions_identity_fixed
BEFORE UPDATE OF id, strategy_id, base_version_id, created_at ON strategy_versions
BEGIN
  SELECT RAISE(ABORT, 'strategy version identity and lineage are fixed');
END;

-- Groups and rules can only be written while their version is a Draft.
CREATE TRIGGER rule_groups_draft_only_insert
BEFORE INSERT ON rule_groups
WHEN (SELECT state FROM strategy_versions WHERE id = NEW.strategy_version_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'rule groups can only be added to a draft');
END;

CREATE TRIGGER rule_groups_draft_only_update
BEFORE UPDATE ON rule_groups
WHEN (SELECT state FROM strategy_versions WHERE id = OLD.strategy_version_id) <> 'DRAFT'
  OR NEW.strategy_version_id <> OLD.strategy_version_id
BEGIN
  SELECT RAISE(ABORT, 'rule groups of a published version are immutable');
END;

CREATE TRIGGER rule_groups_draft_only_delete
BEFORE DELETE ON rule_groups
WHEN (SELECT state FROM strategy_versions WHERE id = OLD.strategy_version_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'rule groups of a published version are immutable');
END;

CREATE TRIGGER rules_draft_only_insert
BEFORE INSERT ON rules
WHEN (SELECT state FROM strategy_versions WHERE id = NEW.strategy_version_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'rules can only be added to a draft');
END;

CREATE TRIGGER rules_draft_only_update
BEFORE UPDATE ON rules
WHEN (SELECT state FROM strategy_versions WHERE id = OLD.strategy_version_id) <> 'DRAFT'
  OR NEW.strategy_version_id <> OLD.strategy_version_id
BEGIN
  SELECT RAISE(ABORT, 'rules of a published version are immutable');
END;

CREATE TRIGGER rules_draft_only_delete
BEFORE DELETE ON rules
WHEN (SELECT state FROM strategy_versions WHERE id = OLD.strategy_version_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'rules of a published version are immutable');
END;

-- A Draft is never evaluated: trades may only point at Published Versions.
CREATE TRIGGER trades_version_must_be_published_insert
BEFORE INSERT ON trades
WHEN NEW.strategy_version_id IS NOT NULL
  AND (SELECT state FROM strategy_versions WHERE id = NEW.strategy_version_id) <> 'PUBLISHED'
BEGIN
  SELECT RAISE(ABORT, 'a trade can only reference a published strategy version');
END;

CREATE TRIGGER trades_version_must_be_published_update
BEFORE UPDATE OF strategy_version_id ON trades
WHEN NEW.strategy_version_id IS NOT NULL
  AND (SELECT state FROM strategy_versions WHERE id = NEW.strategy_version_id) <> 'PUBLISHED'
BEGIN
  SELECT RAISE(ABORT, 'a trade can only reference a published strategy version');
END;

-- A recorded association is never silently re-pointed at another version.
CREATE TRIGGER trades_version_association_fixed
BEFORE UPDATE OF strategy_version_id ON trades
WHEN OLD.strategy_version_id IS NOT NULL AND NEW.strategy_version_id IS NOT OLD.strategy_version_id
BEGIN
  SELECT RAISE(ABORT, 'a trade''s strategy version association cannot be changed');
END;

-- Executions are immutable normalized facts.
CREATE TRIGGER executions_no_update
BEFORE UPDATE ON executions
BEGIN
  SELECT RAISE(ABORT, 'executions are immutable');
END;

CREATE TRIGGER executions_no_delete
BEFORE DELETE ON executions
BEGIN
  SELECT RAISE(ABORT, 'executions cannot be deleted');
END;

-- An evaluation may change state; its coordinates (trade, version, rule) never.
CREATE TRIGGER trade_rule_evaluations_coordinates_fixed
BEFORE UPDATE OF trade_id, strategy_version_id, rule_id ON trade_rule_evaluations
BEGIN
  SELECT RAISE(ABORT, 'evaluation trade, version and rule are fixed');
END;

CREATE TRIGGER trade_rule_evaluations_no_delete
BEFORE DELETE ON trade_rule_evaluations
BEGIN
  SELECT RAISE(ABORT, 'evaluations cannot be deleted');
END;
`
}
