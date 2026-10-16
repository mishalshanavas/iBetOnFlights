#!/usr/bin/env python3
"""Fetch official CAA monthly route aggregates; never manufacture individual flights."""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
AIRPORTS = {
    "HEATHROW": "EGLL", "GATWICK": "EGKK", "MANCHESTER": "EGCC", "EDINBURGH": "EGPH",
    "AMSTERDAM": "EHAM", "FRANKFURT MAIN": "EDDF", "PARIS (CHARLES DE GAULLE)": "LFPG",
    "MADRID": "LEMD", "MUNICH": "EDDM", "ROME (FIUMICINO)": "LIRF", "DUBLIN": "EIDW",
    "BRUSSELS": "EBBR", "ZURICH": "LSZH", "BARCELONA": "LEBL", "MILAN (MALPENSA)": "LIMC",
    "COPENHAGEN": "EKCH", "OSLO (GARDERMOEN)": "ENGM", "STOCKHOLM (ARLANDA)": "ESSA",
    "VIENNA": "LOWW", "LISBON": "LPPT", "WARSAW (CHOPIN)": "EPWA", "ATHENS": "LGAV",
    "NEW YORK (JF KENNEDY)": "KJFK", "DUBAI": "OMDB",
}
BANDS = [
    "flights_more_than_15_minutes_early_percent", "flights_15_minutes_early_to_1_minute_early_percent",
    "flights_0_to_15_minutes_late_percent", "flights_between_16_and_30_minutes_late_percent",
    "flights_between_31_and_60_minutes_late_percent", "flights_between_61_and_120_minutes_late_percent",
    "flights_between_121_and_180_minutes_late_percent", "flights_between_181_and_360_minutes_late_percent",
    "flights_more_than_360_minutes_late_percent",
]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "FlightGuard research data importer"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                if urllib.parse.urlparse(response.url).hostname != "www.caa.co.uk":
                    raise ValueError("Unexpected download redirect host")
                return response.read()
        except (OSError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def convert(row, url, retrieved):
    reporting, other = AIRPORTS.get(row["reporting_airport"]), AIRPORTS.get(row["origin_destination"])
    if not reporting or not other or reporting == other or row["scheduled_charter"] != "S":
        return None
    if row["arrival_departure"] not in ("A", "D"):
        raise ValueError("Unrecognized arrival/departure direction")
    matched, unmatched, cancelled = [int(row[k]) for k in
        ("number_flights_matched", "actual_flights_unmatched", "number_flights_cancelled")]
    if min(matched, unmatched, cancelled) < 0:
        raise ValueError("Negative CAA flight counts")
    if matched == 0:
        return None
    total = matched + unmatched + cancelled
    percentages = [float(row[k]) for k in BANDS]
    if any(not 0 <= value <= 100 for value in percentages):
        raise ValueError("Invalid CAA percentages")
    # CAA percentages use ALL flights, including cancellations and unmatched movements.
    # Six-decimal percentages reconstruct integer counts; fail if they do not reconcile.
    exact = [percentage * total / 100 for percentage in percentages]
    counts = [round(value) for value in exact]
    if sum(counts) != matched or any(abs(value - count) > 0.01 for value, count in zip(exact, counts)):
        raise ValueError("CAA published percentages do not reconcile with matched movements")
    airline = row["airline_name"].strip().upper()
    key = "|".join([row["reporting_period"], reporting, other, airline, row["arrival_departure"]])
    return {"id": "caa-" + hashlib.sha256(key.encode()).hexdigest()[:40],
        "period": row["reporting_period"], "reportingAirport": reporting, "otherAirport": other,
        "airline": airline, "direction": row["arrival_departure"], "matched": matched,
        "unmatched": unmatched, "cancelled": cancelled, "late30": sum(counts[4:]),
        "late60": sum(counts[5:]), "late180": sum(counts[7:]),
        "averageDelay": float(row["average_delay_mins"]) if row["average_delay_mins"] else None,
        "sourceUrl": url, "sourceRunDate": row["run_date"], "retrievedAt": retrieved}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--start-period", help="First reporting month, YYYYMM (default: previous 12 months)")
    parser.add_argument("--end-period", help="Last reporting month, YYYYMM inclusive")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/imports/caa")
    parser.add_argument("--refresh", action="store_true", help="Refresh cached CSV downloads")
    args = parser.parse_args()
    current = datetime.now(timezone.utc)
    index = current.year * 12 + current.month - 1
    start = index - 12
    def period_index(value):
        if not re.fullmatch(r"20\d{2}(0[1-9]|1[0-2])", value):
            parser.error("Periods must be YYYYMM")
        return int(value[:4]) * 12 + int(value[4:]) - 1
    if args.start_period:
        start = period_index(args.start_period)
    end = period_index(args.end_period) if args.end_period else index - 1
    if not start <= end < index:
        parser.error("Select completed reporting months, with start <= end")
    links = {}
    for year in range(start // 12, end // 12 + 1):
        page = f"https://www.caa.co.uk/data-and-analysis/uk-aviation-market/flight-punctuality/uk-flight-punctuality-statistics/{year}/"
        content = fetch(page).decode("utf-8")
        for href, body in re.findall(r'<a\b[^>]*href=[\"\']([^\"\']+)[\"\'][^>]*>(.*?)</a>', content, re.S | re.I):
            label = html.unescape(re.sub(r"<[^>]+>", " ", body))
            label = " ".join(label.split())
            match = re.search(r"(20\d{4}).*Full Analysis Arrival Departure", label, re.I)
            if not match:
                continue
            period = match.group(1)
            month_number = int(period[:4]) * 12 + int(period[4:]) - 1
            if start <= month_number <= end:
                url = urllib.parse.urljoin(page, html.unescape(href))
                if urllib.parse.urlparse(url).hostname != "www.caa.co.uk":
                    raise ValueError("Unexpected download host")
                links[period] = url
    if not links:
        raise RuntimeError("No eligible official CAA monthly CSV links found")
    target = args.output_dir
    target.mkdir(parents=True, exist_ok=True)
    records = {}
    retrieved = int(current.timestamp())
    downloads = []
    for period, url in sorted(links.items()):
        cache = target / f"{period}.csv"
        data = cache.read_bytes() if cache.exists() and not args.refresh else fetch(url)
        if not cache.exists() or args.refresh:
            cache.write_bytes(data)
        try:
            decoded = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            decoded = data.decode("cp1252")
        source_rows = list(csv.DictReader(io.StringIO(decoded)))
        imported = 0
        for row in source_rows:
            if row["reporting_period"] != period:
                raise ValueError("CSV reporting period does not match its download label")
            converted = convert(row, url, retrieved)
            if converted:
                if converted["id"] in records:
                    raise ValueError("Duplicate CAA scheduled-service cohort")
                records[converted["id"]] = converted
                imported += 1
        print(f"{period}: {imported} supported route/airline/direction aggregates", flush=True)
        downloads.append({"period": period, "url": url, "sha256": hashlib.sha256(data).hexdigest(),
                          "bytes": len(data), "aggregateRecords": imported})
    output = target / "records.json"
    output.write_text(json.dumps(list(records.values())))
    (target / "manifest.json").write_text(json.dumps({"provider": "UK Civil Aviation Authority",
        "retrievedAt": retrieved, "downloads": links, "files": downloads, "aggregateRecords": len(records),
        "individualFlightRecords": 0, "countBasis": "Integer counts reconstructed from published six-decimal percentages"}, indent=2))
    print(f"Prepared {len(records)} real published aggregates. Individual flights were not generated.", flush=True)
    if not args.dry_run:
        env = os.environ.copy()
        env_file = ROOT / ".env.local"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if "=" in line and not line.startswith("#"):
                    key, value = line.split("=", 1)
                    env.setdefault(key, value.strip().strip('"').strip("'"))
        subprocess.run([str(ROOT / "node_modules/.bin/tsx"), "scripts/import-punctuality.ts", str(output)],
                       cwd=ROOT, env=env, check=True)


if __name__ == "__main__":
    main()
