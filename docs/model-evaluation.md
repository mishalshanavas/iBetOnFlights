# Model data, training, and evaluation

No model, training sample, or validation result ships with this repository. The inference endpoint responds `MODEL_UNAVAILABLE` until a compatible operator-trained export exists. This prevents unvalidated percentages from looking like real predictions.

Acquire historical schedules and actual arrival labels from a legitimately licensed flight-status/history source, airline/airport open dataset, or research agreement. Aircraft state vectors do not supply scheduled arrival, cancellation status, or airline responsibility. US BTS records may support research, but a model trained and tested on US data must not be advertised as validated for Europe.

Acquire archived **forecasts issued before the prediction time**, rather than realized future weather. Current historical weather observations are unsuitable replacements for pre-departure forecasts. Compute route and airport historical aggregates using only flights whose labels were already known at prediction time. The pipeline validates timestamp order, but cannot independently authenticate the provenance or causal availability of each submitted value.

CSV columns:

```
origin,destination,source,region,scheduled_departure,scheduled_arrival,
forecast_issued_at,aggregates_computed_at,arrival_delay_min,
route_distance_km,route_delay_rate,airport_delay_rate,
wind_speed_ms,wind_gust_ms,precipitation_mm,visibility_m,cloud_cover_pct
```

Times must be offset-aware ISO timestamps. Origin and destination use ICAO codes. Historical rate values are fractions (0–1), cloud cover is percent (0–100), and weather units are SI. `region=Europe` is required for all held-out rows when explicitly asserting `--european-evaluation`. Source names must refer to actual datasets, not fabricated providers.

Training requires at least 300 records and both label classes for each 30/60/180-minute threshold in every partition. This minimum only avoids degenerate training; it does not establish adequate coverage or statistical power. Departure timestamps are sorted and grouped; the first 60% of distinct instants define training, the next 20% calibration, and the final 20% the untouched test period. Equal departure instants never cross partitions. Airport encoding is fitted using training data only.

Each threshold uses LightGBM, followed by logistic probability calibration on a separate time period. A historical route baseline is used for 30-minute delay and training-period empirical threshold rates for 60/180-minute delay. The runtime applies a conservative cumulative minimum to enforce monotonic thresholds. Test evaluation uses the same adjustment.

The export includes model version, airport encoding, ordered feature contract, numeric trees, logistic calibration parameters, training date, test period, and metrics. The pipeline verifies summed exported tree values against native LightGBM raw scores. TypeScript performs identical tree traversal and calibration with no Python server, native model runtime, or persistent service. Unsupported categorical tree exports are rejected.

Outputs:

- `model.json`: deployment-compatible model and metadata.
- `evaluation.json`: samples, period boundaries, source list, baseline Brier/PR-AUC, model PR-AUC/ROC-AUC/precision/recall/F1/Brier, confusion matrix, calibration bins, feature importance, and per-airport Brier scores.
- `calibration.png`: held-out calibration figure.

Geographic representativeness, sample size, forecast availability, drift, seasonality, imported cancellation labels, and out-of-distribution airport pairs need external review. Small per-airport samples are not reliable estimates. No distribution, uncertainty interval, expected delay regression, rotation feature, or SHAP explanation is inferred when its required model/data is absent. Retrain and restart the app to load a new export.
