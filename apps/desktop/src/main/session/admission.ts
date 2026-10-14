/**
 * Resolves once `deliver` reports admission and rejects if it settles without
 * one. A send settles only when its turn ends; after admission the send path
 * owns the turn and its error events, so the caller waits for neither.
 */
export function untilAdmitted(deliver: (onAccepted: () => void) => Promise<unknown>, notAdmitted: () => Error): Promise<void> {
  return new Promise((resolve, reject) => {
    let accepted = false
    const onAccepted = (): void => { accepted = true; resolve() }
    void deliver(onAccepted).then(() => { if (!accepted) reject(notAdmitted()) }, error => { if (!accepted) reject(error) })
  })
}
