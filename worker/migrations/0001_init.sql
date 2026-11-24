-- Enforcer NSMEN initial schema

CREATE TABLE IF NOT EXISTS departments (
  name TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL
);

INSERT OR IGNORE INTO departments (name, sort_order) VALUES
  ('Pilot', 1),
  ('Loadmaster', 2),
  ('Tacco', 3),
  ('Sup1', 4),
  ('Sup2', 5);

CREATE TABLE IF NOT EXISTS nsmen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dept TEXT NOT NULL REFERENCES departments(name),
  tg_id TEXT NOT NULL UNIQUE,
  tg_username TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nsmen_dept_active ON nsmen(dept, active);

CREATE TABLE IF NOT EXISTS planners (
  tg_id TEXT NOT NULL,
  dept TEXT NOT NULL REFERENCES departments(name),
  PRIMARY KEY (tg_id, dept)
);

CREATE TABLE IF NOT EXISTS flight_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dept TEXT NOT NULL REFERENCES departments(name),
  date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  UNIQUE (dept, date)
);

CREATE INDEX IF NOT EXISTS idx_flight_days_dept_date ON flight_days(dept, date);

CREATE TABLE IF NOT EXISTS cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nsman_id INTEGER NOT NULL REFERENCES nsmen(id),
  date TEXT NOT NULL,
  state TEXT NOT NULL,
  dept TEXT NOT NULL REFERENCES departments(name),
  planned_by TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT '',
  ended_at TEXT NOT NULL DEFAULT '',
  ended_by TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  UNIQUE (nsman_id, date)
);

CREATE INDEX IF NOT EXISTS idx_cells_nsman_date ON cells(nsman_id, date);
CREATE INDEX IF NOT EXISTS idx_cells_dept_date ON cells(dept, date);

CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_log_at ON log(at);
