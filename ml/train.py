"""Offline LightGBM training, chronological calibration and serverless JSON export."""
import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from features import FEATURES, validate_record, chronological_split, vector

def main():
    import numpy as np
    import lightgbm as lgb
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import average_precision_score, roc_auc_score, brier_score_loss, precision_score, recall_score, f1_score, confusion_matrix
    from sklearn.calibration import calibration_curve
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", default="ml/models")
    parser.add_argument("--european-evaluation", action="store_true", help="Assert that documented genuine European records underpin this evaluation.")
    args = parser.parse_args()
    with open(args.dataset, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) < 300:
        raise ValueError("Need at least 300 genuine labelled records; larger representative samples are recommended.")
    for row in rows:
        validate_record(row)
    train, calibration, test = chronological_split(rows)
    if args.european_evaluation and not all(r["region"].lower() == "europe" for r in test):
        raise ValueError("European validation requires European test records and documented provenance.")
    encoding = {airport: i for i, airport in enumerate(sorted({r[k] for r in train for k in ("origin", "destination")}))}
    x_train, x_cal, x_test = [np.array([vector(row, encoding) for row in partition], dtype=np.float64) for partition in (train, calibration, test)]
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    model_outputs, raw_probabilities, metrics = [], [], {}
    fig, ax = plt.subplots(figsize=(6, 5))
    ax.plot([0, 1], [0, 1], "--", color="gray", label="Ideal")
    for threshold in (30, 60, 180):
        y_train, y_cal, y_test = [np.array([float(row["arrival_delay_min"]) >= threshold for row in part], dtype=int) for part in (train, calibration, test)]
        if any(len(np.unique(y)) < 2 for y in (y_train, y_cal, y_test)):
            raise ValueError(f"Each chronological partition must include positive and negative labels for {threshold}+ minute delay.")
        model = lgb.LGBMClassifier(n_estimators=150, num_leaves=15, max_depth=6, learning_rate=0.04, min_child_samples=25, random_state=42, verbosity=-1)
        model.fit(x_train, y_train)
        calibrator = LogisticRegression(C=1.0, random_state=42)
        calibrator.fit(model.predict(x_cal, raw_score=True).reshape(-1, 1), y_cal)
        scores = model.predict(x_test, raw_score=True)
        probabilities = calibrator.predict_proba(scores.reshape(-1, 1))[:, 1]
        raw_probabilities.append(probabilities)
        dump = model.booster_.dump_model()
        model_outputs.append({"threshold": threshold, "trees": [t["tree_structure"] for t in dump["tree_info"]], "calibration": {"a": float(calibrator.coef_[0, 0]), "b": float(calibrator.intercept_[0])}})
        # Verify the exact exported tree evaluator against native LightGBM raw scores.
        def evaluate(node, values):
            if "leaf_value" in node:
                return node["leaf_value"]
            if node["decision_type"] != "<=":
                raise ValueError("Categorical tree export is unsupported; numeric features required.")
            return evaluate(node["left_child"] if values[node["split_feature"]] <= float(node["threshold"]) else node["right_child"], values)
        reconstructed = np.array([sum(evaluate(t["tree_structure"], row) for t in dump["tree_info"]) for row in x_test[:20]])
        if not np.allclose(reconstructed, scores[:20], rtol=1e-8, atol=1e-8):
            raise ValueError("Exported inference differs from native LightGBM.")
        baseline = np.array([float(row["route_delay_rate"]) for row in test]) if threshold == 30 else np.full(len(test), y_train.mean())
        metrics[str(threshold)] = {"baselineBrier": brier_score_loss(y_test, baseline), "baselinePRAUC": average_precision_score(y_test, baseline), "featureImportance": dict(zip(FEATURES, model.feature_importances_.tolist()))}
    # Evaluate the same monotonic adjustment as the deployed TypeScript runtime.
    adjusted = np.minimum.accumulate(np.stack(raw_probabilities, axis=1), axis=1)
    for index, threshold in enumerate((30, 60, 180)):
        y = np.array([float(row["arrival_delay_min"]) >= threshold for row in test], dtype=int)
        p = adjusted[:, index]
        pred = p >= 0.5
        metrics[str(threshold)].update({"prAuc": average_precision_score(y, p), "rocAuc": roc_auc_score(y, p), "brier": brier_score_loss(y, p), "precision": precision_score(y, pred, zero_division=0), "recall": recall_score(y, pred, zero_division=0), "f1": f1_score(y, pred, zero_division=0), "confusionMatrix": confusion_matrix(y, pred).tolist()})
        actual, predicted = calibration_curve(y, p, n_bins=10, strategy="quantile")
        metrics[str(threshold)]["calibration"] = {"predicted": predicted.tolist(), "observed": actual.tolist()}
        ax.plot(predicted, actual, marker="o", label=f"{threshold}+ min")
        metrics[str(threshold)]["byAirport"] = {}
        for airport in sorted({r["destination"] for r in test}):
            mask = np.array([r["destination"] == airport for r in test])
            metrics[str(threshold)]["byAirport"][airport] = {"count": int(mask.sum()), "brier": brier_score_loss(y[mask], p[mask])}
    ax.set(xlabel="Predicted probability", ylabel="Observed delay rate", title="Held-out chronological calibration")
    ax.legend()
    fig.tight_layout()
    fig.savefig(output / "calibration.png", dpi=180)
    periods = {key: [part[0]["scheduled_departure"], part[-1]["scheduled_departure"]] for key, part in zip(("train", "calibration", "test"), (train, calibration, test))}
    metadata = {"version": "flightguard-lgbm-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"), "features": FEATURES, "airportEncoding": encoding, "evaluatedOnEuropeanRecords": args.european_evaluation, "trainedAt": datetime.now(timezone.utc).isoformat(), "testPeriod": periods["test"], "metrics": metrics, "models": model_outputs}
    (output / "model.json").write_text(json.dumps(metadata, allow_nan=False), encoding="utf-8")
    report = {"records": len(rows), "partitionSizes": [len(train), len(calibration), len(test)], "periods": periods, "sources": sorted({r["source"] for r in rows}), "evaluatedOnEuropeanRecords": args.european_evaluation, "metrics": metrics, "limitations": "Temporal validation cannot prove representativeness. Archived forecast issuance and aggregate provenance require external audit. No European claim is permitted for US-only training. Feature attribution is not causation."}
    (output / "evaluation.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    print(f"Model and held-out evaluation exported to {output}; no fabricated data was created.")

if __name__ == "__main__":
    main()
