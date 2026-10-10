"""Pre-departure feature contract for genuine European gate-arrival records.

Only schedule fields are predictors. Actual times are labels, never features.
This module uses the standard library so data validation works without sklearn.
"""
import math
from datetime import datetime, timezone

EUROPEAN_AIRPORTS = {
    "EGLL", "EHAM", "EDDF", "LFPG", "LEMD", "EDDM", "LIRF", "EIDW",
    "EBBR", "LSZH", "EGKK", "EGCC", "EGPH", "LEBL", "LIMC", "EKCH",
    "ENGM", "ESSA", "LOWW", "LPPT", "EPWA", "LGAV",
}
CATEGORICAL = ["origin", "destination", "operatingAirline"]
NUMERIC = ["departure_hour_sin", "departure_hour_cos", "weekday_sin",
           "weekday_cos", "month_sin", "month_cos", "duration_hours"]
THRESHOLDS = [30, 60, 180]
CONTRACT = "europe-schedule-logistic-v1"
LEAD_SECONDS = 3600


def instant(value):
    if isinstance(value, bool):
        raise ValueError("Invalid timestamp")
    if isinstance(value, (int, float)):
        if not math.isfinite(value) or value <= 0:
            raise ValueError("Timestamps must be positive finite Unix seconds")
        datetime.fromtimestamp(value, timezone.utc)
        return float(value)
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("Timestamps must have a UTC offset")
    if dt.timestamp() <= 0:
        raise ValueError("Timestamps must be positive")
    return dt.timestamp()


def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_record(row):
    required = ["id", "flightNumber", "operatingAirline", "originIcao",
                "destinationIcao", "scheduledDeparture", "scheduledArrival",
                "actualArrival", "scheduleObservedAt", "labelObservedAt",
                "arrivalTimeBasis", "source"]
    for field in required:
        if row.get(field) in (None, ""):
            raise ValueError(f"Missing required field: {field}")
    origin, destination = row["originIcao"].upper(), row["destinationIcao"].upper()
    if origin not in EUROPEAN_AIRPORTS or destination not in EUROPEAN_AIRPORTS:
        raise ValueError("Only supported European airport pairs can train this model")
    if origin == destination:
        raise ValueError("Origin and destination must differ")
    if row["arrivalTimeBasis"] != "gate":
        raise ValueError("Labels require actual gate/in-block arrival; runway landing is not gate arrival")
    if str(row.get("status", "")).lower() in {"cancelled", "canceled", "diverted", "c", "d"}:
        raise ValueError("Cancelled/diverted flights require a separate target and must not be labelled on-time")
    departure, arrival, actual = [instant(row[k]) for k in
                                  ["scheduledDeparture", "scheduledArrival", "actualArrival"]]
    schedule_at, label_at = [instant(row[k]) for k in ["scheduleObservedAt", "labelObservedAt"]]
    prediction_at = departure - LEAD_SECONDS
    if not 0 < arrival - departure <= 24 * 3600:
        raise ValueError("Scheduled arrival must follow departure within 24 hours")
    if actual <= departure or actual - arrival > 7 * 86400:
        raise ValueError("Actual arrival is inconsistent with the itinerary")
    if schedule_at > prediction_at:
        raise ValueError("Future-data leakage: schedule must have been observed at least one hour before departure")
    if label_at < actual:
        raise ValueError("Label cannot be known before the flight actually arrived")
    if label_at > datetime.now(timezone.utc).timestamp():
        raise ValueError("Future outcomes are not historical training data")
    if not isinstance(row["source"], str) or len(row["source"].strip()) < 3:
        raise ValueError("Identify the genuine source of each record")
    airline = str(row["operatingAirline"]).strip().upper()
    if not airline or len(airline) > 100:
        raise ValueError("Operating airline is required, not a marketing codeshare")
    return {"id": str(row["id"]), "flightNumber": str(row["flightNumber"]).strip().upper(),
            "origin": origin, "destination": destination, "operatingAirline": airline,
            "scheduledDeparture": departure, "scheduledArrival": arrival,
            "actualArrival": actual, "predictionAt": prediction_at,
            "scheduleObservedAt": schedule_at, "labelObservedAt": label_at,
            "delayMinutes": (actual - arrival) / 60, "source": row["source"].strip()}


def validate_dataset(rows):
    records, ids, identities = [], set(), set()
    for index, row in enumerate(rows):
        try:
            r = normalize_record(row)
            identity = (r["operatingAirline"], r["flightNumber"], r["origin"],
                        r["destination"], r["scheduledDeparture"])
            if r["id"] in ids or identity in identities:
                raise ValueError("Duplicate flight identity; repeated/codeshare rows must not inflate samples")
            ids.add(r["id"])
            identities.add(identity)
            records.append(r)
        except (ValueError, TypeError, OverflowError, AttributeError) as e:
            raise ValueError(f"Record {index + 1}: {e}") from e
    return sorted(records, key=lambda r: r["predictionAt"])


def numeric_features(row):
    dt = datetime.fromtimestamp(row["scheduledDeparture"], timezone.utc)
    hour = dt.hour + dt.minute / 60 + dt.second / 3600
    phases = [hour / 24, dt.weekday() / 7, (dt.month - 1) / 12]
    return [value for phase in phases for value in
            (math.sin(2 * math.pi * phase), math.cos(2 * math.pi * phase))] + [
                (row["scheduledArrival"] - row["scheduledDeparture"]) / 3600]


def split_records(records):
    times = sorted({r["predictionAt"] for r in records})
    if len(times) < 10:
        raise ValueError("Need at least ten distinct prediction timestamps")
    train_cut, calibration_cut = times[int(len(times) * .6)], times[int(len(times) * .8)]
    # A label becoming available after the next phase starts cannot train that phase.
    train = [r for r in records if r["predictionAt"] < train_cut and r["labelObservedAt"] < train_cut]
    calibration = [r for r in records if train_cut <= r["predictionAt"] < calibration_cut
                   and r["labelObservedAt"] < calibration_cut]
    test = [r for r in records if r["predictionAt"] >= calibration_cut]
    return (train, calibration, test), {"trainCut": iso(train_cut), "calibrationCut": iso(calibration_cut),
                                      "purgedLabels": len(records) - len(train) - len(calibration) - len(test)}
