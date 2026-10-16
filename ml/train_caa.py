#!/usr/bin/env python3
"""Select, calibrate, test and export a small, directly executable LightGBM ensemble."""
import argparse
import hashlib
import json
from pathlib import Path

from caa_model import (CONTRACT, MIN_MONTHS, MIN_SUPPORT, THRESHOLDS, aggregate, baseline,
                       compact_tree, evaluate, feature_names, logit, now_iso, prepare,
                       score, split, supported, vector, vocabulary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("ml/datasets/caa/records.json"))
    parser.add_argument("--output", type=Path, default=Path("ml/models"))
    parser.add_argument("--report", type=Path, default=Path("docs/caa-model-evaluation.json"))
    args = parser.parse_args()
    import lightgbm as lgb
    import numpy as np
    from sklearn.linear_model import LogisticRegression

    raw = args.input.read_bytes()
    rows = prepare(json.loads(raw))
    partitions = split(rows)
    train = partitions["train"]
    totals, vocab = aggregate(train), vocabulary(train)
    # Coverage is fixed from training alone, before examining held-out labels.
    for name in ("selection", "calibration", "test"):
        partitions[name] = [r for r in partitions[name] if supported(r, totals)]
        if len(partitions[name]) < 100:
            raise ValueError(f"Insufficient supported {name} cohorts")
    matrices = {name: np.array([vector(r, vocab) for r in part]) for name, part in partitions.items()}
    models, selections = [], {}
    for threshold in THRESHOLDS:
        def binary(name):
            part = partitions[name]
            positives = np.array([r[f"late{threshold}"] for r in part])
            counts = np.array([r["matched"] for r in part])
            weights = np.column_stack([positives, counts - positives]).ravel()
            keep = weights > 0
            return np.repeat(matrices[name], 2, axis=0)[keep], np.tile([1, 0], len(part))[keep], weights[keep]
        x, y, weights = binary("train")
        sx, sy, sw = binary("selection")
        prior = np.array([baseline(r, totals, threshold) for r in partitions["selection"]])
        candidates = []
        for leaves in (7, 15, 31):
            model = lgb.LGBMClassifier(n_estimators=500, learning_rate=.025, num_leaves=leaves,
                min_child_samples=40, reg_lambda=20, verbosity=-1, random_state=42, n_jobs=4,
                deterministic=True, force_col_wise=True)
            model.fit(x, y, sample_weight=weights, eval_X=sx, eval_y=sy, eval_sample_weight=[sw],
                      callbacks=[lgb.early_stopping(40, verbose=False)])
            learned = model.predict_proba(matrices["selection"])[:, 1]
            for blend in (0, .25, .5, .75, 1):
                p = blend * learned + (1 - blend) * prior
                metrics = evaluate(partitions["selection"], p, threshold)
                candidates.append((metrics["logLoss"], model, blend, leaves, metrics))
        _, selected, blend, leaves, selection_metrics = min(candidates, key=lambda c: c[0])
        cal_rows = partitions["calibration"]
        cal_p = blend * selected.predict_proba(matrices["calibration"])[:, 1] + (1 - blend) * np.array([baseline(r, totals, threshold) for r in cal_rows])
        _, cy, cw = binary("calibration")
        full_weights = np.array([[r[f"late{threshold}"], r["matched"] - r[f"late{threshold}"]] for r in cal_rows]).ravel()
        cal_x = np.repeat(np.array([logit(p) for p in cal_p]), 2)[full_weights > 0].reshape(-1, 1)
        calibrator = LogisticRegression(C=1, max_iter=1000).fit(cal_x, cy, sample_weight=cw)
        a, b = float(calibrator.coef_[0, 0]), float(calibrator.intercept_[0])
        if a <= 0:
            raise ValueError("Calibration reversed risk ranking")
        models.append({"threshold": threshold, "trees": [compact_tree(t["tree_structure"]) for t in selected.booster_.dump_model()["tree_info"]],
                       "blend": blend, "calibration": {"a": a, "b": b}})
        selections[str(threshold)] = {"leaves": leaves, "trees": selected.best_iteration_, "blend": blend, "metrics": selection_metrics}
        # Validate the exported tree format against native LightGBM before release.
        from caa_model import sigmoid, tree_value
        native = selected.predict_proba(matrices["test"])[:, 1]
        exported = np.array([sigmoid(sum(tree_value(t, v) for t in models[-1]["trees"])) for v in matrices["test"]])
        if not np.allclose(native, exported, atol=1e-10):
            raise ValueError("Exported tree scores do not match native LightGBM")
        print(f"{threshold} minutes: selected {selected.best_iteration_} trees, {leaves} leaves, ML blend {blend}", flush=True)

    periods = {name: sorted({r["period"] for r in part}) for name, part in partitions.items()}
    artifact = {"contract": CONTRACT, "kind": "calibrated-binomial-lightgbm", "version": "caa-lgbm-" + now_iso().replace(":", "").replace("-", ""),
                "trainedAt": now_iso(), "features": feature_names(vocab), "vocabulary": vocab, "baseline": totals, "models": models,
                "dataThrough": periods["calibration"][-1], "periods": periods, "minimumRouteSamples": MIN_SUPPORT,
                "minimumRouteMonths": MIN_MONTHS, "maximumModelAgeDays": 180, "maximumHorizonDays": 180,
                "dataset": {"provider": "UK Civil Aviation Authority", "sha256": hashlib.sha256(raw).hexdigest(),
                            "aggregateRecords": len(rows), "matchedMovements": sum(r["matched"] for r in rows),
                            "sourceUrls": sorted({r["sourceUrl"] for r in rows}),
                            "periods": sorted({r["period"] for r in rows}), "individualFlightRecords": 0},
                "evaluationScope": "Retrospective monthly route/airline cohorts, with one-month embargoes. Not individual-flight accuracy or a point-in-time backtest; later report revisions can affect results."}
    test = partitions["test"]
    predictions = np.array([score(artifact, r) for r in test])
    metrics, reasons = {}, []
    # Release rules are defined before evaluation; never tune on these months.
    for i, threshold in enumerate(THRESHOLDS):
        m = evaluate(test, predictions[:, i], threshold)
        route = evaluate(test, [baseline(r, totals, threshold) for r in test], threshold)
        g = totals["global"]
        global_rate = (g[f"late{threshold}"] + .5) / (g["matched"] + 1)
        global_metrics = evaluate(test, [global_rate] * len(test), threshold)
        m.update({"seasonalRouteBaseline": route, "globalBaseline": global_metrics,
                  "brierSkillVsRoute": 1 - m["brier"] / route["brier"],
                  "brierSkillVsGlobal": 1 - m["brier"] / global_metrics["brier"]})
        metrics[str(threshold)] = m
        if min(m["positives"], m["negatives"]) < 30:
            reasons.append(f"Insufficient held-out classes for {threshold} minutes")
        if m["brier"] >= global_metrics["brier"] or m["logLoss"] >= global_metrics["logLoss"]:
            reasons.append(f"{threshold}-minute probabilities do not beat the global baseline")
        if m["brier"] > route["brier"] * 1.01 or m["logLoss"] > route["logLoss"] * 1.01:
            reasons.append(f"{threshold}-minute probabilities materially underperform the seasonal route baseline")
        # Month-level diagnostics; no independent-flight confidence intervals are claimed.
        months = sorted({r["period"] for r in test})
        m["monthly"] = {month: evaluate([r for r in test if r["period"] == month],
                                      predictions[[r["period"] == month for r in test], i], threshold) for month in months}
    artifact["metrics"] = metrics
    artifact["release"] = {"passed": not reasons, "reasons": reasons}
    artifact["partitionSamples"] = {name: {"cohorts": len(part), "matchedMovements": sum(r["matched"] for r in part)} for name, part in partitions.items()}
    # Parity fixtures are real aggregate inputs, with no invented flight timestamps.
    artifact["parity"] = [{"input": {name: r[name] for name in ("origin", "destination", "airline", "direction", "period")},
                           "probabilities": score(artifact, r)} for r in test[::max(1, len(test) // 20)]]
    args.output.mkdir(parents=True, exist_ok=True)
    destination = args.output / ("caa-model.json" if not reasons else "candidate-caa-model.json")
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(artifact, allow_nan=False, separators=(",", ":")))
    temporary.replace(destination)
    report = {k: v for k, v in artifact.items() if k not in {"models", "baseline", "vocabulary", "features", "parity"}}
    report["selection"] = selections
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, allow_nan=False, indent=2) + "\n")
    print(json.dumps({"artifact": str(destination), "release": artifact["release"], "samples": artifact["partitionSamples"],
                      "test": {t: {k: v for k, v in m.items() if k in {"brier", "prAuc", "rocAuc", "calibrationError", "brierSkillVsRoute", "brierSkillVsGlobal"}} for t, m in metrics.items()}}, indent=2))
    if reasons:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
