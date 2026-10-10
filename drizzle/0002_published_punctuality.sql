CREATE TABLE IF NOT EXISTS published_punctuality (
  id TEXT PRIMARY KEY NOT NULL,
  period TEXT NOT NULL,
  reporting_airport TEXT NOT NULL,
  other_airport TEXT NOT NULL,
  airline TEXT NOT NULL,
  direction TEXT NOT NULL,
  matched INTEGER NOT NULL,
  unmatched INTEGER NOT NULL,
  cancelled INTEGER NOT NULL,
  late30 INTEGER NOT NULL,
  late60 INTEGER NOT NULL,
  late180 INTEGER NOT NULL,
  average_delay REAL,
  source_url TEXT NOT NULL,
  source_run_date TEXT NOT NULL,
  retrieved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS punctuality_route ON published_punctuality(reporting_airport,other_airport,airline,direction,period);
