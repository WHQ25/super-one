# Subscription usage estimates

Claude and Codex subscription meters estimate when the included quota will run
out at the recent consumption rate. Desktop and mobile use the same host
observations and shared forecast/risk functions. Session token counts are not
used: the provider's account quota also includes usage from other clients.

## Sampling and estimates

The host tracks each account, quota window and reset independently. Claude
identities include the organization; Codex identities include the credential
profile. Opaque keys, never credentials, cross the UI/remote boundary.

- Active turns and an open desktop usage popover refresh every five minutes.
  Starting/finishing turns and manual refreshes continue to fetch readings.
- The tracker holds at most one hour of readings in host memory. Restarting the
  host loses this history. It needs at least four independent readings spanning
  15 minutes and at least one percentage point of consumption to estimate.
- Interval rates use elapsed wall-clock time, with a 20-minute weighting
  half-life. Flat intervals count; after 20 minutes with no growth the estimate
  pauses. It describes continued usage at this pace, not working hours.
- Cached and failed requests do not advance the source timestamp. Samples less
  than a minute apart cannot confirm a forecast. Observations more than ten
  minutes old lose their forecast coloring and cannot suppress warnings.
- A different reset, a decrease in reported consumption, or a gap over 15
  minutes starts a new series. Account changes never reuse another account's
  cached reading. The tracker is bounded to 256 account/window histories.

## Presentation and warnings

Each window shows either an approximate time to exhaustion, that usage should
last until reset, or why an estimate is unavailable (learning, idle or stale).
Remaining percentages and provider reset times remain visible.

An estimate at least 20% beyond the remaining reset time is considered safe.
Within 20% of the reset boundary, the meter is cautious without proactively
interrupting the user. Exhaustion clearly before reset is a warning; exhaustion
within 30 minutes is urgent. Two independent observations must agree before a
forecast triggers a bubble or suppresses the provider's early warning.

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

- Shared forecast and alert tests cover reset timing, acceleration, inactivity,
  stale/cache handling, account separation, window selection and alert episodes.
- Claude/Codex source tests cover cache timestamps, failed reads and login
  changes. Harness transport tests preserve forecasts on the phone.
- Desktop `UsageStatusIcon` and mobile usage-panel tests cover safe-warning
  suppression and rejection precedence.
- Storybook `Sidebar/SubscriptionUsage` has safe, risky, urgent, boundary,
  learning, idle, stale and rejected scenarios. `Mobile/ContextRing` includes
  forecast panel scenarios.
