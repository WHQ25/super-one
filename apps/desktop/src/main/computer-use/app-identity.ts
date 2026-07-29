import type { UiRootIdentity } from './types'

export type RunningAppMeta = {
  app: string
  bundleId: string
  pid: number
  frontmost: boolean
}

export function uniqueApps(
  roots: Array<Omit<UiRootIdentity, 'rootId'> | UiRootIdentity>,
): RunningAppMeta[] {
  const apps = new Map<string, RunningAppMeta>()
  for (const root of roots) {
    if (!apps.has(root.bundleId)) {
      apps.set(root.bundleId, {
        app: root.app,
        bundleId: root.bundleId,
        pid: root.pid,
        frontmost: root.focused,
      })
    } else if (root.focused) {
      apps.get(root.bundleId)!.frontmost = true
    }
  }
  return [...apps.values()]
}

export function matchRunningApp(
  running: RunningAppMeta[],
  query: string,
  /** Extra aliases (localized names / prior resolve) that should match this query. */
  aliases: string[] = [],
): RunningAppMeta | undefined {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return undefined

  const aliasSet = new Set(
    [normalized, ...aliases.map((a) => a.trim().toLowerCase()).filter(Boolean)],
  )

  return running.find((entry) => aliasSet.has(entry.bundleId.toLowerCase()))
    ?? running.find((entry) => aliasSet.has(entry.app.toLowerCase()))
    ?? running.find((entry) => {
      const app = entry.app.toLowerCase()
      return [...aliasSet].some((a) => app.includes(a) || a.includes(app))
    })
}

/** True when a string is almost certainly a reverse-DNS bundle id, not a display name. */
export function looksLikeBundleId(value: string): boolean {
  const q = value.trim()
  return q.includes('.') && !q.includes(' ') && !q.includes('/')
}

export function targetIdentity(
  root: UiRootIdentity,
): Pick<UiRootIdentity, 'app' | 'bundleId' | 'title'> {
  return {
    app: root.app,
    bundleId: root.bundleId,
    title: root.title,
  }
}
