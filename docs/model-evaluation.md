# Model data, training, and evaluation

## Bundled European cohort model

`ml/models/caa-model.json` is a released calibrated LightGBM artifact. It runs in the existing Next.js and Lambda prediction services, without a Python web server. The source is official UK Civil Aviation Authority monthly Arrival/Departure punctuality CSVs. The importer downloads January 2023 onward by default, caches the original bytes, validates integer reconstruction of the delay bands, and records source links, retrieval times and SHA-256 hashes. Downloads are reproducible by URL and checksum; later CAA revisions can change the upstream bytes. Use `--refresh` to refresh the cache deliberately.

The setup uses pinned dependencies in `ml/requirements-caa-lock.txt` and requires Python 3.12 or later. The validated environment is Python 3.14, LightGBM 4.7.0 and scikit-learn 1.9.1. The older feature/weather research pipeline keeps its separate full requirements in `ml/requirements.txt`.

Run `npm run ml:setup` to install offline dependencies, download the reports and train. The download is about 45 MB of CSVs; prepared records add about 16 MB. Raw files are ignored by Git. `npm run ml:train` reuses the prepared data. A failed release writes `candidate-caa-model.json` and preserves the last released model. The runtime validates the artifact, reloads it when its file changes, and disables stale models 180 days after the end of their calibration month. Historical fallbacks retain their own explicit method labels.

The initial dataset has 13,908 European monthly route/airline/direction cohorts representing 1,058,694 matched movements, from 44 reporting months through August 2026. These are **not individual flight records** or necessarily distinct flights. UK domestic movements may appear at both reporting airports. Coverage is limited to mapped European routes linked to Heathrow, Gatwick, Manchester and Edinburgh; an arbitrary intra-EU itinerary is unsupported. New airports, airlines and route cohorts are never silently treated as familiar data.

Targets are CAA delays **strictly greater than 30, 60 and 180 minutes** at the reporting UK airport, conditional on a matched operated movement. UK arrivals and UK departures are distinct targets. Cancelled and unmatched movements are excluded from the delay target and denominator. CAA planned times can change up to 30 minutes before operation; missing gate times may be derived from runway times and assumed taxi durations. This does not establish predictability relative to the schedule originally booked by a passenger.

Only month, origin, destination, airline, route and reporting direction are predictors. Actual delay, average delay, realized weather and future outcomes are never input features. Categories and seasonal route-history baselines are fitted on training data alone. Each aggregate contributes a weighted positive and negative binary observation using its actual counts; no synthetic flight histories or timestamps are created. These weighted observations give exactly the same binary loss and probability metrics as the corresponding counts at the cohort score. They do not supply flight-level discrimination within a cohort.

The initial frozen protocol uses whole reporting months:

| Partition | Period | Supported cohorts | Matched movements |
| --- | --- | ---: | ---: |
| Training | Jan 2023–Nov 2025 | 10,979 | 842,382 |
| Model selection | Jan–Feb 2026 | 559 | 42,493 |
| Calibration | Apr–May 2026 | 575 | 47,505 |
| Held-out evaluation | Jul–Aug 2026 | 568 | 47,318 |

December 2025, March 2026 and June 2026 are embargo months. This approximates publication lag, but the downloaded reports are current revisions: this is a retrospective chronological evaluation, **not a historical point-in-time replay**. Test eligibility is fixed from training coverage (100 matched movements and three distinct training months per route/airline/direction), before looking at test outcomes. Every supported held-out cohort is included.

Three LightGBM tree sizes and five blend weights with a smoothed seasonal route baseline are compared on selection-period binomial log loss. The selected scores are sigmoid-calibrated on separate months. Models remain frozen during the held-out evaluation. A cumulative minimum enforces nested probabilities, and the reported metrics include that exact runtime adjustment. Python verifies exported trees against native LightGBM; TypeScript tests verify all exported parity fixtures to 12 decimal places.

| Delay target | ROC-AUC | PR-AUC | Prevalence | Brier | Brier improvement vs seasonal route baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| >30 min | 0.623 | 0.267 | 18.12% | 0.14409 | 2.55% |
| >60 min | 0.654 | 0.117 | 6.61% | 0.06148 | -0.37% |
| >180 min | 0.703 | 0.0107 | 0.40% | 0.003967 | 0.13% |

This is modest cohort-level discrimination. The 60-minute model's Brier score is slightly worse than the route baseline, although its log loss improves; 180-minute improvements are marginal. Most flights are on time, so a headline classification accuracy would be misleading. We do not claim individual-flight precision, exact delay minutes, confidence bounds, or strong severe-delay detection. Month/cohort outcomes are correlated, so the matched-movement counts must not be interpreted as independent statistical trials. Only two held-out months are available in this initial protocol; evaluate future months before inferring robustness across seasons.

Release requires at least 30 positive and negative held-out movements at every threshold, improvement over training-prevalence baseline in Brier and log loss, and no more than 1% relative regression against the stronger seasonal route baseline in either metric. This is an engineering acceptance gate, not a guarantee of accuracy. Full metrics, monthly diagnostics, calibration bins, selection results and dataset hash are in [caa-model-evaluation.json](caa-model-evaluation.json). The 60-minute regression is deliberately visible.

The source, [CAA methodology](https://www.caa.co.uk/data-and-analysis/uk-aviation-market/flight-punctuality/uk-flight-punctuality-statistics-notes/), and [publication terms](https://www.caa.co.uk/data-and-analysis/uk-aviation-market/flight-punctuality/uk-flight-punctuality-statistics/2026/) must remain attributed. CAA prohibits selling its statistical data to third parties. This backend does not connect live airline rotations, archived weather forecasts, airport congestion, ATFM restrictions or cancellations to individual outcomes. Those require authentic flight-level history and live providers to support a materially stronger individual-flight model.

## Optional individual-flight feature pipeline

The older weather-feature model below is a separate operator-trained contract. Its `model.json` is not bundled. `POST /api/predict` with a `features` object continues to use that contract; an itinerary body uses the bundled cohort model. `/api/model/status` includes its availability as `featureModel`.

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
