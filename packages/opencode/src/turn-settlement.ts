/** A native terminal fact can finish the turn even when its HTTP receipt is lost. */
export async function waitForOpenCodeTurn(dispatch: Promise<unknown>, finished: Promise<void>): Promise<void> {
  // Keep a rejection handler on the dispatch after the terminal wins the race.
  // The caller cancels its scoped transport without repeating the native input.
  await Promise.race([finished, dispatch.then(() => finished)])
}
