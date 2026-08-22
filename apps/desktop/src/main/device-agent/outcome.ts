/**
 * Did the action actually do anything?
 *
 * Judged by re-observing the device, never by whether the input call returned
 * without error. Delivering a touch always "succeeds" — the guest accepts the event
 * regardless of whether anything was under the finger — so an API-level success
 * proves only that the event was sent. That gap is exactly where an agent reports a
 * button pressed that was never pressed.
 *
 * `unknown` is a real answer and must stay available. Some screens legitimately look
 * identical after a correct action (a toggle with no visual state, a control that
 * only changes something off-screen), and collapsing those into `didnt` would send
 * the agent into a retry loop against a device that already did what was asked.
 */
export type DeviceActOutcome = 'worked' | 'didnt' | 'unknown'

export interface OutcomeInput {
  /** False when the backend refused or threw — a hard failure. */
  applied: boolean
  /** Result of the caller's postcondition, when one was given. */
  expectMet?: boolean
  /** Whether the screen looks different afterwards. */
  changed: boolean
  /**
   * False when the screen could not be read back at all — see `treeUnavailable`.
   *
   * Its own input rather than folded into `changed`, because the two answers differ
   * in kind: `changed: false` says we looked and nothing moved, while this says we
   * could not look. Both land on `unknown`, and the agent needs different advice for
   * each — one is "say what success looks like", the other is "stop the motion first".
   */
  readable?: boolean
}

export interface OutcomeJudgement {
  outcome: DeviceActOutcome
  /** Why, in one phrase — this is what the agent reads when it has to decide again. */
  reason: string
}

export function judgeOutcome(input: OutcomeInput): OutcomeJudgement {
  if (!input.applied) return { outcome: 'didnt', reason: 'the device refused the input' }
  // An explicit postcondition outranks the screen diff: the caller said what success
  // means, so a changed screen that fails the check is still a failure.
  if (input.expectMet === false) {
    return { outcome: 'didnt', reason: 'the expected condition did not hold afterwards' }
  }
  if (input.expectMet === true) return { outcome: 'worked', reason: 'the expected condition held' }
  // Checked BEFORE `changed`, because an unreadable screen makes `changed` meaningless
  // rather than true: the tree channel vanishing counts as a difference to the
  // fingerprint, so every action on a video feed would otherwise report `worked`.
  if (input.readable === false) {
    return {
      outcome: 'unknown',
      reason: 'the input was delivered, but this screen could not be read back — it never '
        + 'goes idle, which a playing video does. Compare screenshots, or stop the motion '
        + 'and snapshot again, rather than repeating the action',
    }
  }
  if (input.changed) return { outcome: 'worked', reason: 'the screen changed' }
  return {
    outcome: 'unknown',
    reason: 'the input was delivered but the screen looks unchanged — '
      + 'pass expect to say what success looks like, rather than repeating the action',
  }
}
