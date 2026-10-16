"""Binomial learning from published CAA cohorts, without inventing flight rows."""
import math
from collections import defaultdict
from datetime import datetime, timezone

THRESHOLDS = [30, 60, 180]
CATEGORIES = ["origin", "destination", "airline", "direction", "route"]
CONTRACT = "caa-europe-cohort-v1"
MIN_SUPPORT = 100
MIN_MONTHS = 3


def key(row):
    return "|".join(row[name] for name in ("origin", "destination", "airline", "direction"))


def prepare(rows):
    """Restrict to European airport pairs; each direction has its own target."""
    records, seen = [], set()
    for row in rows:
        if row["reportingAirport"] in {"KJFK", "OMDB"} or row["otherAirport"] in {"KJFK", "OMDB"}:
            continue
        n = row["matched"]
        counts = [row[f"late{t}"] for t in THRESHOLDS]
        if not isinstance(n, int) or n <= 0 or any(not isinstance(c, int) for c in counts):
            raise ValueError("Cohorts require positive integer denominators and integer labels")
        if not 0 <= counts[2] <= counts[1] <= counts[0] <= n:
            raise ValueError("Delay bands must be nested and bounded by matched movements")
        if row["direction"] not in {"A", "D"}:
            raise ValueError("Unknown target direction")
        origin, destination = ((row["otherAirport"], row["reportingAirport"]) if row["direction"] == "A"
                               else (row["reportingAirport"], row["otherAirport"]))
        if origin == destination:
            raise ValueError("Origin and destination must differ")
        r = dict(row, origin=origin, destination=destination, airline=row["airline"].strip().upper())
        r["route"] = key(r)
        identity = (r["period"], r["route"])
        if identity in seen:
            raise ValueError("Duplicate reporting cohort")
        seen.add(identity)
        records.append(r)
    return sorted(records, key=lambda r: (r["period"], r["route"]))


def split(rows):
    periods = sorted({r["period"] for r in rows})
    if len(periods) < 24:
        raise ValueError("At least 24 reporting months are required")
    # An unused month separates partitions to approximate publication lag.
    groups = {"train": periods[:-9], "selection": periods[-8:-6],
              "calibration": periods[-5:-3], "test": periods[-2:]}
    return {name: [r for r in rows if r["period"] in selected] for name, selected in groups.items()}


def vocabulary(rows):
    return {name: sorted({r[name] for r in rows}) for name in CATEGORIES}


def feature_names(vocab):
    return ["month_sin", "month_cos"] + [f"{name}={value}" for name in CATEGORIES for value in vocab[name]]


def vector(row, vocab):
    phase = 2 * math.pi * (int(row["period"][4:]) - 1) / 12
    return [math.sin(phase), math.cos(phase)] + [float(row[name] == value) for name in CATEGORIES for value in vocab[name]]


def aggregate(rows):
    result = defaultdict(lambda: {"matched": 0, "late30": 0, "late60": 0, "late180": 0, "periods": set()})
    for row in rows:
        for name in ("global", "route:" + row["route"], "airline:" + row["airline"], "month:" + row["period"][4:]):
            a = result[name]
            for field in ("matched", "late30", "late60", "late180"):
                a[field] += row[field]
            a["periods"].add(row["period"])
    return {name: dict(value, periods=sorted(value["periods"])) for name, value in result.items()}


def supported(row, totals):
    a = totals.get("route:" + row["route"], {})
    return a.get("matched", 0) >= MIN_SUPPORT and len(a.get("periods", [])) >= MIN_MONTHS


def baseline(row, totals, threshold):
    field = f"late{threshold}"
    g = totals["global"]
    prior = (g[field] + 0.5) / (g["matched"] + 1)
    airline = totals.get("airline:" + row["airline"], {})
    rate = (airline.get(field, 0) + 500 * prior) / (airline.get("matched", 0) + 500)
    route = totals.get("route:" + row["route"], {})
    rate = (route.get(field, 0) + 200 * rate) / (route.get("matched", 0) + 200)
    month = totals.get("month:" + row["period"][4:], g)
    seasonal = (month[field] + 500 * prior) / (month["matched"] + 500)
    # Multiplicative seasonality on odds, learned only from the training partition.
    return sigmoid(logit(rate) + logit(seasonal) - logit(prior))


def logit(p):
    p = max(1e-9, min(1 - 1e-9, float(p)))
    return math.log(p / (1 - p))


def sigmoid(x):
    return 1 / (1 + math.exp(-max(-700, min(700, float(x)))))


def evaluate(rows, probabilities, threshold):
    """Exact movement-weighted binary metrics, retaining cohort dependence."""
    import numpy as np
    from sklearn.metrics import average_precision_score, roc_auc_score
    p = np.clip(np.asarray(probabilities), 1e-9, 1 - 1e-9)
    n = np.array([r["matched"] for r in rows], dtype=float)
    y = np.array([r[f"late{threshold}"] for r in rows], dtype=float)
    total = n.sum()
    brier = (y * (1 - p) ** 2 + (n - y) * p ** 2).sum() / total
    loss = -(y * np.log(p) + (n - y) * np.log1p(-p)).sum() / total
    # One positive/negative weighted observation per cohort is algebraically exact.
    labels, scores, weights = np.tile([1, 0], len(rows)), np.repeat(p, 2), np.column_stack([y, n - y]).ravel()
    mask = weights > 0
    bins = []
    for indices in np.array_split(np.argsort(p), min(10, len(rows))):
        if len(indices):
            mass = n[indices].sum()
            bins.append({"movements": int(mass), "predicted": float(np.average(p[indices], weights=n[indices])),
                         "observed": float(y[indices].sum() / mass)})
    return {"brier": float(brier), "logLoss": float(loss), "prAuc": float(average_precision_score(labels[mask], scores[mask], sample_weight=weights[mask])),
            "rocAuc": float(roc_auc_score(labels[mask], scores[mask], sample_weight=weights[mask])),
            "prevalence": float(y.sum() / total), "meanPrediction": float(np.average(p, weights=n)),
            "positives": int(y.sum()), "negatives": int((n - y).sum()), "movements": int(total), "cohorts": len(rows),
            "calibrationError": sum(b["movements"] * abs(b["predicted"] - b["observed"]) for b in bins) / total,
            "calibrationBins": bins}


def compact_tree(node):
    if "leaf_value" in node:
        return {"leaf_value": node["leaf_value"]}
    if node["decision_type"] != "<=":
        raise ValueError("Only numerical tree splits are exported")
    return {"split_feature": node["split_feature"], "threshold": float(node["threshold"]),
            "decision_type": "<=", "default_left": node["default_left"],
            "left_child": compact_tree(node["left_child"]), "right_child": compact_tree(node["right_child"])}


def tree_value(node, values):
    while "leaf_value" not in node:
        node = node["left_child"] if values[node["split_feature"]] <= node["threshold"] else node["right_child"]
    return node["leaf_value"]


def score(artifact, row):
    values = vector(row, artifact["vocabulary"])
    probabilities = []
    for model in artifact["models"]:
        learned = sigmoid(sum(tree_value(tree, values) for tree in model["trees"]))
        prior = baseline(row, artifact["baseline"], model["threshold"])
        blended = model["blend"] * learned + (1 - model["blend"]) * prior
        probabilities.append(sigmoid(model["calibration"]["a"] * logit(blended) + model["calibration"]["b"]))
    return [min(probabilities[:i + 1]) for i in range(3)]


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
