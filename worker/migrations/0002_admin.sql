-- Highest Admin singleton table and planner display names

CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tg_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

ALTER TABLE planners ADD COLUMN name TEXT NOT NULL DEFAULT '';
