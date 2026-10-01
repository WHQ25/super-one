# Subscription usage estimates

Claude and Codex subscription meters estimate when the included quota will run
out at the average consumption rate since the current cycle started, matching
[OpenUsage pacing](https://github.com/robinebers/openusage/blob/main/Sources/OpenUsage/Support/Pace.swift). Desktop
and mobile use the same host observations and shared forecast/risk functions.
Session token counts are not
used: the provider's account quota also includes usage from other clients.

## Sampling and estimates

The host tracks each account, quota window and reset independently. Claude
identities include the organization; Codex identities include the credential
profile. Opaque keys, never credentials, cross the UI/remote boundary.

- Active turns and an open desktop usage popover refresh every five minutes.
  Starting/finishing turns and manual refreshes continue to fetch readings.
- With a known duration and future reset, positive consumption is divided by
  elapsed time since cycle start (reset minus duration). Remaining quota divided
  by that rate gives the projected time to exhaustion. No recent-rate estimator
  or inactivity cutoff is used.
- Estimation starts after the greater of one minute or 1% of the cycle duration.
  Zero consumption, missing duration/reset, and inactive cycles have no estimate.
- Cached and failed requests do not advance the source timestamp. Readings less
  than a minute apart cannot confirm a forecast. Observations more than ten
  minutes old lose forecast coloring and cannot suppress warnings.
- Only the latest independent reading is retained per account/window. A different
  reset, consumption decrease, or gap over 15 minutes clears confirmation, but
  a valid cycle average is available immediately. Storage is bounded to 256
  account/window entries; inactive entries expire after one hour.

## Presentation and warnings

An approximate exhaustion time is shown only when exhaustion falls strictly
before reset, using cycle-average wording. Insufficient data shows no forecast
line; stale data is labelled. Remaining percentages and reset times stay visible.
Readings without a valid forecast use percentage thresholds for meter colors.
Zero consumption is always green; fills use only green, amber and red.

Projected consumption at reset determines pacing: at most 90% is safe/green,
above 90% through 100% is close/amber, and above 100% means exhaustion before
reset (red). Exhaustion within 30 minutes also receives urgent alert severity. Two independent observations must agree on the risk before a forecast
triggers a bubble or suppresses the provider's early warning. These confirmation
and alert rules remain SuperOne-specific.

Desktop selects the earliest relevant window and shows a six-second bubble.
Model-specific pools only generate forecasts for the selected model. Bubbles
are deduplicated per account/window/reset across sessions in the renderer;
severity escalation and ten minutes of confirmed recovery can re-arm them.
Restarting the renderer clears this notification ledger. Mobile displays the
same estimates and risk colors in its usage panel without adding unsolicited
popups.

An actual provider rejection always takes priority. A safe forecast only
suppresses an early warning for a matching window, with no newer reported
consumption spike. Missing or ambiguous window identifiers do not permit
guessing. Expired provider warnings are discarded. Other providers retain
their existing threshold behavior.

## Verification

- Shared forecast and alert tests cover reset timing, cycle-average rates, initial-window protection, inactivity,
  stale/cache handling, account separation, window selection and alert episodes.
- Claude/Codex source tests cover cache timestamps, failed reads and login
  changes. Harness transport tests preserve forecasts on the phone.
- Desktop `UsageStatusIcon` and mobile usage-panel tests cover safe-warning
  suppression and rejection precedence.
- Storybook `Sidebar/SubscriptionUsage` has safe, risky, urgent, boundary,
  missing-duration, quiet, stale and rejected scenarios. `Mobile/ContextRing` includes
  forecast panel scenarios.
