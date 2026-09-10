# Mobile Send taps that leave the draft untouched

Two code paths accepted a tap visually and then returned before sending:

- Session restore made the transcript visible before `loadSystemInfo` completed,
  but kept `SessionTransition.isActive` set until that optional metadata request
  settled. `send()` silently returned while the lock was active.
- The native composer's `canSubmit()` rejected IME composition, pending edits and
  the last rejected edit. The enabled button did not reflect those conditions,
  and tapping it neither committed composition nor explained the rejection.

Session metadata now refreshes in the background after history restoration. Its
response is checked against the current runtime and request generation, so a late
response cannot overwrite a different session. Failed metadata no longer tears
down a successfully created session. The Send button is disabled during the
actual restore, with a defensive status message if the transition guard is hit.

Explicit Send now requests `prepareSubmit` from the native editor. iOS ends
marked text; Android clears composition and restarts the input connection. Both
return the authoritative structured draft with a submission ID. JavaScript waits
for this acknowledgement before capturing the draft. Pending insertions settle
first; rapid taps are coalesced through preparation and sending. A timeout or
native error preserves the draft and surfaces an error. Changing conversations
or unmounting during preparation cancels the send.

The native capability is advertised in editor snapshots. Older native clients
retain the settled-draft send path and receive an explanation when composition
blocks it, rather than receiving an unsupported editing command. The full IME
fix requires rebuilding the iOS/Android development client; a JS-only reload
cannot add it. Keyboard Return retains its existing IME confirmation guards.

Component regressions cover composition acknowledgement, pending edits,
rejections, timeouts/retry, older clients, duplicate taps, controller refreshes,
session switches, transport errors and restore-time button state. State tests
cover slow/failed/stale catalogs. The interactive native preview uses the same
send hook; Storybook entry: `Mobile/ChatComposer/SendAfterComposition`.

These tests reproduce the identified code paths; confirmation on the user's
specific keyboard/device remains a manual check.
