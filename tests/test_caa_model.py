from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ml"))
from caa_model import aggregate, baseline, evaluate, prepare, split, supported, vector, vocabulary


def row(period="202301", **overrides):
    return {"period": period, "reportingAirport": "EGLL", "otherAirport": "EHAM", "airline": "KLM",
            "direction": "A", "matched": 100, "late30": 20, "late60": 10, "late180": 1, **overrides}


class CaaModelTests(unittest.TestCase):
    def test_grouped_binary_metrics_equal_individual_binary_metrics(self):
        records = prepare([row(), row("202302", late30=40)])
        metrics = evaluate(records, [.1, .3], 30)
        from sklearn.metrics import brier_score_loss, log_loss, average_precision_score, roc_auc_score
        labels = [1] * 20 + [0] * 80 + [1] * 40 + [0] * 60
        scores = [.1] * 100 + [.3] * 100
        for key, fn in (("brier", brier_score_loss), ("logLoss", log_loss), ("prAuc", average_precision_score), ("rocAuc", roc_auc_score)):
            self.assertAlmostEqual(metrics[key], fn(labels, scores), places=12)

    def test_split_preserves_whole_months_and_leaves_an_embargo(self):
        rows = prepare([row(f"{year}{month:02}") for year in range(2023, 2027) for month in range(1, 13)])
        parts = split(rows)
        previous_end = None
        for part in parts.values():
            first, last = part[0]["period"], part[-1]["period"]
            if previous_end:
                index = lambda p: int(p[:4]) * 12 + int(p[4:])
                self.assertGreater(index(first) - index(previous_end), 1)
            previous_end = last

    def test_never_uses_delay_counts_or_average_delay_as_features(self):
        a = prepare([row()])[0]
        b = {**a, "late30": 99, "late60": 90, "late180": 50, "averageDelay": 300}
        self.assertEqual(vector(a, vocabulary([a])), vector(b, vocabulary([a])))

    def test_direction_and_support_are_separate(self):
        rows = prepare([row("202301"), row("202302"), row("202303")])
        totals = aggregate(rows)
        self.assertTrue(supported(rows[0], totals))
        departure = prepare([row(direction="D")])[0]
        self.assertFalse(supported(departure, totals))
        self.assertGreater(baseline(rows[0], totals, 30), baseline(rows[0], totals, 180))

    def test_rejects_bad_counts_duplicates_and_non_european_pairs(self):
        with self.assertRaises(ValueError):
            prepare([row(late180=21)])
        with self.assertRaises(ValueError):
            prepare([row(), row()])
        self.assertEqual(prepare([row(otherAirport="KJFK")]), [])


if __name__ == "__main__":
    unittest.main()
