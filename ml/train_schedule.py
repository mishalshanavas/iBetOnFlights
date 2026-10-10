"""Train calibrated schedule-only logistic models on real European flight history.

No download, fabricated training sample, or automatic deployment is performed.
"""
import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from schedule import (CATEGORICAL, NUMERIC, THRESHOLDS, CONTRACT, LEAD_SECONDS,
                      validate_dataset, numeric_features, split_records, iso)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, help="JSON array or CSV of provenance-labelled flights")
    parser.add_argument("--output", default="ml/models")
    parser.add_argument("--min-class-count", type=int, default=20,
                        help="Minimum positives AND negatives for every threshold in every partition")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    if args.min_class_count < 20:
        parser.error("--min-class-count cannot be below 20; tiny samples are not deployable")
    path = Path(args.dataset)
    raw = path.read_bytes()
    rows = list(csv.DictReader(raw.decode("utf-8-sig").splitlines())) if path.suffix.lower() == ".csv" else json.loads(raw)
    if not isinstance(rows, list):
        raise ValueError("Dataset must be a JSON array or CSV table")
    records = validate_dataset(rows)
    partitions, boundaries = split_records(records)
    if args.validate_only:
        print(json.dumps({"records": len(records), "partitionSizes": [len(p) for p in partitions], **boundaries}, indent=2))
        return
    if len(records) < 300:
        raise ValueError("At least 300 genuine flights are required; rare severe delays usually require many more")
    for name, partition in zip(["train", "calibration", "test"], partitions):
        for threshold in THRESHOLDS:
            positives = sum(r["delayMinutes"] >= threshold for r in partition)
            if min(positives, len(partition) - positives) < args.min_class_count:
                raise ValueError(f"{name}: {threshold}+ minute target needs at least {args.min_class_count} positives and negatives; got {positives}/{len(partition)-positives}")
    import numpy as np
    from sklearn.preprocessing import OneHotEncoder, StandardScaler
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import brier_score_loss, average_precision_score, roc_auc_score, log_loss

    train, calibration, test = partitions
    encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    scaler = StandardScaler()
    encoder.fit([[r[k] for k in CATEGORICAL] for r in train])
    scaler.fit([numeric_features(r) for r in train])

    def matrix(partition):
        return np.column_stack([scaler.transform([numeric_features(r) for r in partition]),
                                encoder.transform([[r[k] for k in CATEGORICAL] for r in partition])])

    x_train, x_cal, x_test = [matrix(p) for p in partitions]
    models, probabilities, metrics = [], [], {}
    for threshold in THRESHOLDS:
        y_train, y_cal, y_test = [np.array([r["delayMinutes"] >= threshold for r in p], dtype=int) for p in partitions]
        model = LogisticRegression(C=1.0, max_iter=2000, random_state=42)
        model.fit(x_train, y_train)
        from sklearn.exceptions import ConvergenceWarning
        if int(model.n_iter_.max()) >= 2000:
            raise ValueError("Logistic regression failed to converge; inspect data before deployment")
        calibrator = LogisticRegression(C=1.0, max_iter=2000, random_state=42)
        calibrator.fit(model.decision_function(x_cal).reshape(-1, 1), y_cal)
        if int(calibrator.n_iter_.max()) >= 2000:
            raise ValueError("Probability calibration failed to converge")
        p = calibrator.predict_proba(model.decision_function(x_test).reshape(-1, 1))[:, 1]
        probabilities.append(p)
        weights = model.coef_[0]
        cursor = len(NUMERIC)
        categorical_weights = {}
        for name, categories in zip(CATEGORICAL, encoder.categories_):
            categorical_weights[name] = dict(zip(categories.tolist(), weights[cursor:cursor + len(categories)].tolist()))
            cursor += len(categories)
        exported = {"threshold": threshold, "intercept": float(model.intercept_[0]),
                    "numericWeights": weights[:len(NUMERIC)].tolist(), "categoricalWeights": categorical_weights,
                    "calibration": {"a": float(calibrator.coef_[0, 0]), "b": float(calibrator.intercept_[0])}}
        models.append(exported)
        # Check JSON reconstruction before publishing the model artifact.
        scores = [exported["intercept"] + sum(w * x for w, x in zip(exported["numericWeights"], scaler.transform([numeric_features(r)])[0]))
                  + sum(exported["categoricalWeights"][k].get(r[k], 0) for k in CATEGORICAL) for r in test]
        if not np.allclose(scores, model.decision_function(x_test), atol=1e-10, rtol=1e-10):
            raise ValueError("Exported logistic inference differs from sklearn")
        baseline = np.full(len(test), float(y_train.mean()))
        metrics[str(threshold)] = {"trainPrevalence": float(y_train.mean()), "testPrevalence": float(y_test.mean()),
                                   "baselineBrier": float(brier_score_loss(y_test, baseline)),
                                   "baselinePRAUC": float(y_test.mean()), "testPositives": int(y_test.sum()),
                                   "testNegatives": int(len(test) - y_test.sum())}
    adjusted = np.minimum.accumulate(np.stack(probabilities, axis=1), axis=1)
    for index, threshold in enumerate(THRESHOLDS):
        y = np.array([r["delayMinutes"] >= threshold for r in test], dtype=int)
        p = adjusted[:, index]
        metrics[str(threshold)].update({"brier": float(brier_score_loss(y, p)),
                                       "prAuc": float(average_precision_score(y, p)),
                                       "rocAuc": float(roc_auc_score(y, p)), "logLoss": float(log_loss(y, p))})
        # Unknown training categories are not eligible for live inference; expose test coverage.
        supported = np.array([all(r[k] in categories for k, categories in zip(CATEGORICAL, encoder.categories_)) for r in test])
        metrics[str(threshold)]["supportedTestCount"] = int(supported.sum())
        metrics[str(threshold)]["supportedBrier"] = float(brier_score_loss(y[supported], p[supported])) if supported.any() else None
        metrics[str(threshold)]["byRoute"] = {}
        for route in sorted({f'{r["origin"]}-{r["destination"]}' for r in test}):
            mask = np.array([f'{r["origin"]}-{r["destination"]}' == route for r in test])
            metrics[str(threshold)]["byRoute"][route] = {"count": int(mask.sum()), "positives": int(y[mask].sum()),
                                                       "brier": float(brier_score_loss(y[mask], p[mask]))}
    trained_at = datetime.now(timezone.utc).isoformat()
    coverage = {k: categories.tolist() for k, categories in zip(CATEGORICAL, encoder.categories_)}
    route_support = {}
    for r in train:
        key = f'{r["origin"]}|{r["destination"]}|{r["operatingAirline"]}'
        route_support[key] = route_support.get(key, 0) + 1
    supported = [r for r in test if route_support.get(f'{r["origin"]}|{r["destination"]}|{r["operatingAirline"]}', 0) >= 30]
    mask = np.array([route_support.get(f'{r["origin"]}|{r["destination"]}|{r["operatingAirline"]}', 0) >= 30 for r in test])
    release_reasons = []
    if not supported:
        release_reasons.append("No supported airline/route combinations in held-out data")
    else:
        y = np.array([r["delayMinutes"] >= 180 for r in test], dtype=int)[mask]
        p = adjusted[:, 2][mask]
        baseline = np.full(len(y), metrics["180"]["trainPrevalence"])
        supported_brier = float(brier_score_loss(y, p))
        supported_baseline = float(brier_score_loss(y, baseline))
        if min(int(y.sum()), int(len(y) - y.sum())) < args.min_class_count:
            release_reasons.append("Supported held-out flights lack enough severe-delay positives or negatives")
        if supported_brier >= supported_baseline:
            release_reasons.append("Severe-delay model does not beat training-prevalence baseline on supported held-out flights")
        if len(np.unique(y)) == 2 and average_precision_score(y, p) <= y.mean():
            release_reasons.append("Severe-delay discrimination does not beat the held-out prevalence baseline")
        metrics["180"].update({"releaseSampleSize": len(y), "releaseBrier": supported_brier,
                               "releaseBaselineBrier": supported_baseline})
    release = {"passed": not release_reasons, "reasons": release_reasons,
               "minimumRouteSamples": 30, "minimumClassCount": args.min_class_count}
    metadata = {"kind": "schedule-logistic", "contract": CONTRACT,
                "version": "flightguard-schedule-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
                "features": NUMERIC + CATEGORICAL, "numericFeatures": NUMERIC,
                "means": scaler.mean_.tolist(), "scales": scaler.scale_.tolist(), "coverage": coverage,
                "routeSupport": route_support, "predictionLeadSeconds": LEAD_SECONDS,
                "evaluatedOnEuropeanRecords": True, "trainedAt": trained_at,
                "testPeriod": [iso(test[0]["predictionAt"]), iso(test[-1]["predictionAt"])],
                "metrics": metrics, "release": release, "models": models}
    report = {"records": len(records), "partitionSizes": [len(p) for p in partitions],
              "boundaries": boundaries, "sources": sorted({r["source"] for r in records}),
              "datasetSha256": hashlib.sha256(raw).hexdigest(), "metrics": metrics, "release": release,
              "limitations": "Source fields and observation timestamps require external provenance audit. Gate arrival is not proof of compensation eligibility. Cancellation/diversion risk is excluded. Time-ordered validation is not a guarantee of future performance."}
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    candidate_name = "schedule-model.json" if release["passed"] else "candidate-schedule-model.json"
    (output / candidate_name).write_text(json.dumps(metadata, allow_nan=False), encoding="utf-8")
    (output / "evaluation.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    # Portable parity cases verify TypeScript's date features, scaling, categories and calibration.
    parity = [{"input": {"origin": r["origin"], "destination": r["destination"], "operatingAirline": r["operatingAirline"],
                          "scheduledDeparture": r["scheduledDeparture"], "scheduledArrival": r["scheduledArrival"]},
               "probabilities": adjusted[i].tolist()} for i, r in enumerate(test[:20])]
    (output / "parity.json").write_text(json.dumps(parity, allow_nan=False), encoding="utf-8")
    print(json.dumps({"output": str(output / candidate_name), "release": release}, indent=2))
    if not release["passed"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
