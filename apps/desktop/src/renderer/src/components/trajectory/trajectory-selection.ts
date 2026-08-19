/**
 * What the ledger has selected.
 *
 * A request is a first-class selection rather than a field of the record that
 * happened to trigger it: its prompt, options, timing, and usage belong to the
 * call, and several records share one call. Selecting the call directly is the
 * difference between "what did the model answer" and "what was the model
 * actually asked".
 */

export type TrajectorySelection =
  | { kind: 'record'; id: string }
  | { kind: 'request'; ordinal: number }
  | null
