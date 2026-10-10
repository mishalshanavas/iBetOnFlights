import unittest
from features import FEATURES, RAW_NUMERIC, validate_record, chronological_split, vector

def record(hour=10):
    return {"origin": "EHAM", "destination": "EDDF", "source": "test fixture, not training data", "region": "test", "scheduled_departure": f"2026-10-11T{hour:02}:00:00Z", "scheduled_arrival": f"2026-10-11T{hour+1:02}:00:00Z", "forecast_issued_at": "2026-10-11T00:00:00Z", "aggregates_computed_at": "2026-10-10T00:00:00Z", "arrival_delay_min": 10, **{f: 0.2 if f.endswith("rate") else 1 for f in RAW_NUMERIC}}

class FeatureTests(unittest.TestCase):
    def test_future_forecast_rejected(self):
        row = record(); row["forecast_issued_at"] = "2026-10-11T12:00:00Z"
        with self.assertRaisesRegex(ValueError, "leakage"): validate_record(row)
    def test_future_aggregates_rejected(self):
        row = record(); row["aggregates_computed_at"] = "2026-10-11T12:00:00Z"
        with self.assertRaisesRegex(ValueError, "leakage"): validate_record(row)
    def test_missing_feature_rejected(self):
        row = record(); del row["visibility_m"]
        with self.assertRaisesRegex(ValueError, "Missing"): validate_record(row)
    def test_ordered_vector(self):
        row = record(); values = vector(row, {"EHAM": 1, "EDDF": 2})
        self.assertEqual(len(values), len(FEATURES))
        self.assertEqual(values[:6], [1, 2, 10, 11, 6, 10])
    def test_disjoint_time_partitions(self):
        rows = [record(hour) for hour in range(1, 21)] * 2
        train, cal, test = chronological_split(rows)
        self.assertLess(train[-1]["scheduled_departure"], cal[0]["scheduled_departure"])
        self.assertLess(cal[-1]["scheduled_departure"], test[0]["scheduled_departure"])

if __name__ == "__main__": unittest.main()
