CREATE TABLE IF NOT EXISTS flight_prediction_evidence (
  flight_id TEXT PRIMARY KEY NOT NULL,
  schedule_observed_at INTEGER NOT NULL,
  label_observed_at INTEGER,
  arrival_time_basis TEXT NOT NULL
);
