import { uniqueApps } from './app-identity'
import type { ComputerUsePolicy } from './policy'
import type { RootRegistry } from './root-registry'
import type { FakePlatformBackend } from './platform/fake-backend'
import type { PlatformAdapter } from './platform/types'
import type { AppCatalogEntry, AppsListOptions, AppsListResult } from './types'

type RunningAppMeta = { app: string; bundleId: string; pid: number; frontmost: boolean }

export async function listAppCatalog(options: AppsListOptions, deps: {
  adapter: PlatformAdapter; fake: FakePlatformBackend | null; roots: RootRegistry; policy: ComputerUsePolicy
}): Promise<AppsListResult> {
  const { adapter, fake, roots, policy } = deps
  const query = options.query?.trim() || null
  const offset = Math.max(0, Math.floor(options.offset ?? 0))
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 25)))

  const discovered = await adapter.listRoots()
  roots.sync(discovered)

  let running: RunningAppMeta[]
  if (fake) {
    running = fake.listAppsMeta()
  } else if (adapter.listApps) {
    running = await adapter.listApps()
  } else {
    running = uniqueApps(discovered)
  }

  const windowCountByBundle = new Map<string, number>()
  for (const root of roots.list()) {
    if (!root.bundleId) continue
    windowCountByBundle.set(
      root.bundleId,
      (windowCountByBundle.get(root.bundleId) ?? 0) + 1,
    )
  }

  const runningByBundle = new Map(running.map((r) => [r.bundleId, r]))
  const grantByBundle = new Map(
    policy.listGranted()
      .filter((g) => g.bundleId !== '*')
      .map((g) => [g.bundleId, g]),
  )
  const allowAll = policy.isAllowAllApps()

  // Seed catalog from installed apps (macOS) + always include running processes
  // even if not under /Applications (e.g. dev Electron builds).
  const byBundle = new Map<string, {
    app: string
    bundleId: string
    aliases: string[]
  }>()

  if (!fake) {
    try {
      const { listInstalledApps } = await import('./resolve-installed-app')
      for (const installed of await listInstalledApps()) {
        byBundle.set(installed.bundleId, {
          app: installed.app,
          bundleId: installed.bundleId,
          aliases: installed.aliases,
        })
      }
    } catch {
      // ignore scan failures — fall back to running only
    }
  }

  for (const r of running) {
    const existing = byBundle.get(r.bundleId)
    if (existing) {
      if (r.app && !existing.aliases.includes(r.app)) existing.aliases.push(r.app)
      // Prefer live process display name when present.
      if (r.app) existing.app = r.app
    } else {
      byBundle.set(r.bundleId, {
        app: r.app || r.bundleId,
        bundleId: r.bundleId,
        aliases: [r.app, r.bundleId].filter(Boolean),
      })
    }
  }

  // Also surface always-allow entries that aren't installed/running yet.
  for (const g of grantByBundle.values()) {
    if (byBundle.has(g.bundleId)) continue
    byBundle.set(g.bundleId, {
      app: g.app || g.bundleId,
      bundleId: g.bundleId,
      aliases: [g.app, g.bundleId].filter(Boolean),
    })
  }

  const qLower = query?.toLowerCase() ?? null
  let entries: AppCatalogEntry[] = []
  for (const meta of byBundle.values()) {
    if (qLower) {
      const hay = [meta.app, meta.bundleId, ...meta.aliases]
        .join('\0')
        .toLowerCase()
      if (!hay.includes(qLower)) continue
    }
    const live = runningByBundle.get(meta.bundleId)
    const grant = grantByBundle.get(meta.bundleId)
    const granted = allowAll || !!grant
    entries.push({
      app: meta.app,
      bundleId: meta.bundleId,
      running: !!live,
      frontmost: live?.frontmost ?? false,
      granted,
      grantScope: grant?.scope ?? null,
      pid: live?.pid ?? null,
      windows: windowCountByBundle.get(meta.bundleId) ?? 0,
    })
  }

  // Running / frontmost / granted first, then alpha — so page 0 is useful.
  entries.sort((a, b) => {
    if (a.frontmost !== b.frontmost) return a.frontmost ? -1 : 1
    if (a.running !== b.running) return a.running ? -1 : 1
    if (a.granted !== b.granted) return a.granted ? -1 : 1
    return a.app.localeCompare(b.app)
  })

  const total = entries.length
  const page = entries.slice(offset, offset + limit)

  const result: AppsListResult = {
    action: 'list',
    frontmost: running.find((r) => r.frontmost)?.app ?? null,
    clipboardGrant: policy.hasClipboardGrant(),
    query,
    total,
    offset,
    limit,
    hasMore: offset + page.length < total,
    apps: page,
  }

  if (options.includeRoots) {
    result.roots = roots.list().map((r) => ({
      rootId: r.rootId,
      kind: r.kind,
      app: r.app,
      bundleId: r.bundleId,
      pid: r.pid,
      title: r.title,
      focused: r.focused,
      modal: r.modal,
    }))
  }

  return result
}
