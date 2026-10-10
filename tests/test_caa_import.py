import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("caa_import", Path(__file__).resolve().parents[1] / "scripts/import-caa.py")
caa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caa)


class CaaImportTests(unittest.TestCase):
    def row(self):
        row = {"reporting_period": "202601", "reporting_airport": "HEATHROW", "origin_destination": "AMSTERDAM",
               "scheduled_charter": "S", "arrival_departure": "A", "number_flights_matched": "80",
               "actual_flights_unmatched": "10", "number_flights_cancelled": "10", "airline_name": "KLM",
               "average_delay_mins": "12", "run_date": "test fixture"}
        row.update(dict(zip(caa.BANDS, map(str, [0, 0, 40, 20, 10, 5, 3, 2, 0]))))
        return row

    def test_reconstructs_counts_using_all_movements_not_just_matched(self):
        result = caa.convert(self.row(), "https://www.caa.co.uk/example", 1000)
        self.assertEqual(result["matched"], 80)
        self.assertEqual(result["late30"], 20)
        self.assertEqual(result["late60"], 10)
        self.assertEqual(result["late180"], 2)
        self.assertEqual(result["reportingAirport"], "EGLL")

    def test_rejects_percentages_that_do_not_reconcile(self):
        row = self.row()
        row[caa.BANDS[-1]] = "1"
        with self.assertRaises(ValueError):
            caa.convert(row, "https://www.caa.co.uk/example", 1000)

    def test_does_not_map_unknown_airports_or_charters(self):
        row = self.row()
        row["origin_destination"] = "UNKNOWN AIRPORT"
        self.assertIsNone(caa.convert(row, "https://www.caa.co.uk/example", 1000))
        row = self.row()
        row["scheduled_charter"] = "C"
        self.assertIsNone(caa.convert(row, "https://www.caa.co.uk/example", 1000))


if __name__ == "__main__":
    unittest.main()
