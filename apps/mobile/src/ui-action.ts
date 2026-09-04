function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** Captures both synchronous native/send failures and rejected RPC promises. */
export function runUiAction(
  action: () => unknown | PromiseLike<unknown>,
  onError: (message: string) => void,
  fallback = 'action failed',
): void {
  try {
    void Promise.resolve(action()).catch((error) => onError(errorMessage(error, fallback)))
  } catch (error) {
    onError(errorMessage(error, fallback))
  }
}
