/**
 * What a raw event batch says about a project's and a session's extra folders.
 *
 * Read off the batch before `ChatRuntime`, for the same reason the session list
 * is: the new-session landing has no runtime subscribed, and the folder panel
 * has to stay right there too. Frames arrive untyped at that boundary, so this
 * narrows by shape rather than trusting the union.
 */

export type AdditionalDirsReport = {
  /** The project's folders, when an event reported them. */
  projectDirs?: string[]
  /** The session's own folders, when an event that concerns *this* session did. */
  sessionDirs?: string[]
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

export function additionalDirsFromEvents(events: readonly unknown[], scope: {
  projectPath?: string
  sessionId?: string | null
  /** The project's folders, used to subtract them out of an effective set. */
  projectDirs: readonly string[]
}): AdditionalDirsReport {
  const report: AdditionalDirsReport = {}
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const frame = event as Record<string, unknown>

    if (frame.type === 'init_ready') {
      // Opening a session is the only moment the host volunteers what it
      // actually runs with, and it reports the *effective* set. What the project
      // contributes is already known, so the remainder is the session's own —
      // nothing in the protocol asks for that list directly.
      const effective = stringList(frame.additionalDirectories)
      if (effective) report.sessionDirs = effective.filter((dir) => !scope.projectDirs.includes(dir))
      continue
    }

    if (frame.type !== 'additional_dirs_changed') continue
    if (scope.projectPath && frame.projectPath !== scope.projectPath) continue
    const workspaceDirs = stringList(frame.workspaceDirs)
    if (workspaceDirs) report.projectDirs = workspaceDirs
    // A project-scoped write reports whichever session the *desktop* has active,
    // which need not be this device's. Only an event naming ours may repaint it.
    if (!frame.sessionId || frame.sessionId !== scope.sessionId) continue
    const sessionDirs = stringList(frame.sessionAdditionalDirs)
    if (sessionDirs) report.sessionDirs = sessionDirs
  }
  return report
}
