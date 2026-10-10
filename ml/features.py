"""Shared offline feature contract. No future observed weather or delay aggregates."""
from datetime import datetime
import math

FEATURES = ["origin_code", "destination_code", "departure_hour", "arrival_hour", "day_of_week", "month", "route_distance_km", "route_delay_rate", "airport_delay_rate", "wind_speed_ms", "wind_gust_ms", "precipitation_mm", "visibility_m", "cloud_cover_pct"]
RAW_NUMERIC = FEATURES[6:]

def timestamp(value):
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("Timestamps must have a UTC offset.")
    return dt.timestamp()

def validate_record(row):
    for field in ["origin", "destination", "source", "region", "scheduled_departure", "scheduled_arrival", "forecast_issued_at", "aggregates_computed_at", "arrival_delay_min", *RAW_NUMERIC]:
        if row.get(field) in (None, ""):
            raise ValueError(f"Missing required field: {field}")
    departure = timestamp(row["scheduled_departure"])
    if timestamp(row["scheduled_arrival"]) <= departure:
        raise ValueError("Scheduled arrival must follow departure.")
    for field in ["forecast_issued_at", "aggregates_computed_at"]:
        if timestamp(row[field]) > departure:
            raise ValueError(f"Future-data leakage: {field} must precede departure.")
    for field in ["arrival_delay_min", *RAW_NUMERIC]:
        if not math.isfinite(float(row[field])):
            raise ValueError(f"Non-finite feature: {field}")
    for field in ["route_delay_rate", "airport_delay_rate"]:
        if not 0 <= float(row[field]) <= 1:
            raise ValueError(f"Invalid historical rate: {field}")
    if not 0 <= float(row["cloud_cover_pct"]) <= 100:
        raise ValueError("Invalid cloud cover.")
    for field in ["route_distance_km", "wind_speed_ms", "wind_gust_ms", "precipitation_mm", "visibility_m"]:
        if float(row[field]) < 0:
            raise ValueError(f"Negative feature: {field}")
    return departure

def chronological_split(records):
    """Group identical departure instants to keep split boundaries disjoint."""
    records = sorted(records, key=lambda r: timestamp(r["scheduled_departure"]))
    times = sorted(set(timestamp(r["scheduled_departure"]) for r in records))
    if len(times) < 10:
        raise ValueError("Need at least ten distinct departure timestamps.")
    train_cut = times[int(len(times)*0.6)]
    calibration_cut = times[int(len(times)*0.8)]
    return (
        [r for r in records if timestamp(r["scheduled_departure"]) < train_cut],
        [r for r in records if train_cut <= timestamp(r["scheduled_departure"]) < calibration_cut],
        [r for r in records if timestamp(r["scheduled_departure"]) >= calibration_cut],
    )

def vector(row, encoding):
    departure = datetime.fromisoformat(row["scheduled_departure"].replace("Z", "+00:00"))
    arrival = datetime.fromisoformat(row["scheduled_arrival"].replace("Z", "+00:00"))
    from datetime import timezone
    departure, arrival = departure.astimezone(timezone.utc), arrival.astimezone(timezone.utc)
    return [encoding.get(row["origin"], -1), encoding.get(row["destination"], -1), departure.hour, arrival.hour, departure.weekday(), departure.month, *[float(row[f]) for f in RAW_NUMERIC]]
