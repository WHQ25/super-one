export type FatalReloadState = { startedAt: number; count: number }

export function registerFatalChatViewError(
  previous: FatalReloadState,
  now: number,
  windowMs = 10_000,
  maxReloads = 2,
): { state: FatalReloadState; reload: boolean } {
  const state = now - previous.startedAt > windowMs
    ? { startedAt: now, count: 1 }
    : { startedAt: previous.startedAt || now, count: previous.count + 1 }
  return { state, reload: state.count <= maxReloads }
}
