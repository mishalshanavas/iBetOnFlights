# Date-versioned compensation rules

Primary legal references: [Regulation (EC) 261/2004](https://eur-lex.europa.eu/eli/reg/2004/261/oj/eng), [Regulation (EU) 2026/2202](https://eur-lex.europa.eu/eli/reg/2026/2202/oj/eng), and the [European Commission passenger-rights guide](https://europa.eu/youreurope/citizens/travel/passenger-rights/air/index_en.htm).

The rule engine selects `EC261/2004-CJEU-v1` for dates before 23 October 2027 and `EC261-as-amended-EU2026/2202-v1` from that date. It does not apply the amendment to earlier flights. The amendment's arrival-delay wording requires more than three hours; the original framework uses the three-hour case-law threshold. A boundary test distinguishes 180 minutes under the two versions.

Scope uses departures from EU/EEA airports regardless of operating carrier and covered arrivals from outside the area when operated by an applicable carrier. Missing carrier jurisdiction produces an evidence state. The ordinary distance bands use great-circle airport distance and separate intra-EU treatment. UK and Swiss airports exist in the directory but their separate domestic regimes are not implemented.

The calculator considers cancellation notice and rerouting windows, applicable reduction rules, non-public free-ticket exclusions, frequent-flyer tickets, and third-country benefits. It supports ordinary single-leg itineraries. It does not implement every connecting-flight territorial circumstance, denied-boarding case, travel-package remedy, national limitation period, or enforcement interpretation; those require individual review.

Weather, ATC, airport closure, technical faults, strike, security, and unknown reasons are represented independently. A reason category is never sufficient to grant or deny a claim. Supplied extraordinary-circumstances and reasonable-measures evidence produces a possible exemption requiring verification of the causal connection. A user-submitted form never constitutes confirmed legal eligibility. No result is `CONFIRMED_ELIGIBLE` without external adjudication, which this MVP does not implement.

SQLite stores input, result, applicable rule version, missing evidence, timestamp, and explanation for review. A saved assessment is a calculation history entry, not compensation approval. Airline documents, actual arrival-time evidence, booking, cancellation notification, and rerouting timings are still required.
