import { useEffect } from 'react'
import { DEFAULT_BROWSER_PROFILE_ID } from '@superone/shared/agent-types'
import { useBrowserStore } from '@/stores/browser'
import { useBrowserProfilesStore } from '@/stores/browser-profiles'
import {
  browserExecJs,
  browserNavigate,
  browserGoBack,
  browserGoForward,
  browserReload,
  isBrowserRegistered,
  readBrowserConsole,
  webContentsIdForBrowser,
  focusBrowserWebview,
  type ConsoleQuery,
} from './browser-host-api'
import { beginBrowserFocusIsolation, endBrowserFocusIsolation, withBrowserFocusIsolation } from './browser-focus-isolation'
import { isBlankUrl } from './browser-url'
import { closeBrowserTab, openBrowserTab } from '@/components/activity/activity-panel-api'
import { recordDockOpener } from '@/components/activity/dock-ownership'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { captureBrowserScreenshot } from './browser-screenshot'
import { startBrowserRecording, stopBrowserRecording } from './browser-recording'
import { isMiniAppTargetId } from '@superone/shared/miniapp-automation-target'
import type { MiniAppToolPreviewRequest } from '@superone/shared/miniapp-types'
import type { LayoutActRequest } from '@superone/shared/layout-control'
import {
  listMiniAppTargets,
  miniAppTargetWebContentsId,
  miniAppConsoleKeys,
  reloadMiniAppTargets,
  reloadMiniAppView,
  resolveMiniAppTarget,
  subscribeMiniAppHostLogs,
} from '@/components/miniapp/miniapp-automation-targets'
import { showToolUiPreview } from '@/components/miniapp/miniapp-tool-preview-actions'
import {
  BLANK_PAGE_HAS_CUSTOM_CONTENT_SCRIPT,
  clickScript,
  dragDispatchScript,
  hoverScript,
  inspectScript,
  pressScript,
  queryScript,
  resolveNavigateUrl,
  resolvePointScript,
  scrollScript,
  selectScript,
  snapshotScript,
  typeScript,
  waitCheckScript,
} from '@superone/shared/browser-automation-scripts'
import type { PageScriptInput } from '@superone/shared/browser-automation-ops'

export { HELPERS } from '@superone/shared/browser-automation-scripts'

interface BaseInput extends PageScriptInput {
  tab?: string
  console?: ConsoleQuery
  readiness?: 'load' | 'none'
  action?: 'back' | 'forward' | 'reload'
  url?: string
  width?: number
  height?: number
  reset?: boolean
  recordingId?: string
}

function isTabAccessibleToAgent(profileId?: string): boolean {
  const { enabled, profiles } = useBrowserProfilesStore.getState()
  if (!enabled) return true
  const id = profileId ?? DEFAULT_BROWSER_PROFILE_ID
  return profiles.some((p) => p.id === id && p.shareWithAgent)
}

function ownedTabIds(sessionId: string): string[] {
  const state = useBrowserStore.getState()
  return Object.keys(state.tabs).filter(
    (id) => state.tabs[id].owner === sessionId && isTabAccessibleToAgent(state.tabs[id].profileId),
  )
}

function closeOwnedTab(sessionId: string, id: string): void {
  closeBrowserTab(id)
  useAgentViewfinderStore.getState().clear(sessionId, { kind: 'browser', targetId: id })
}

function assertNotMiniAppTarget(tab: string | undefined): void {
  if (isMiniAppTargetId(tab)) throw new Error(`${tab} is a mini-app view; it cannot be opened or closed with browser tools.`)
}

function resolveBrowserId(tab: string | undefined, sessionId: string): string {
  assertNotMiniAppTarget(tab)
  const owned = ownedTabIds(sessionId)
  if (tab) {
    if (!owned.includes(tab)) throw new Error(`Browser tab not found in this session: ${tab}`)
    return tab
  }
  if (owned.length === 1) return owned[0]
  if (owned.length === 0) throw new Error('No browser is open in this session. Use browser_open first.')
  throw new Error(`Multiple browser tabs are open; specify "tab". Open tabs: ${owned.join(', ')}`)
}

function waitForLoadStop(id: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const state = useBrowserStore.getState()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(timer)
      resolve()
    }
    const poll = setInterval(() => {
      if (!useBrowserStore.getState().tabs[id]?.loading) finish()
    }, 100)
    const timer = setTimeout(finish, timeoutMs)
    if (!state.tabs[id]?.loading) {
      setTimeout(() => {
        if (!useBrowserStore.getState().tabs[id]?.loading) finish()
      }, 300)
    }
  })
}

async function waitForTabRegistered(id: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (isBrowserRegistered(id)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Browser tab did not initialize in time')
}

export async function runBrowserOp(sessionId: string, op: string, rawInput: unknown, signal?: AbortSignal): Promise<unknown> {
  const input = (rawInput ?? {}) as BaseInput
  if (op === 'miniappPreview') {
    const shown = await showToolUiPreview(sessionId, rawInput as MiniAppToolPreviewRequest, signal)
    const { openedTabPresentation } = await import('@/lib/layout-control')
    return { ...shown, presentation: openedTabPresentation(sessionId, true) }
  }
  if (op === 'miniappOpen') {
    const { appId, projectDir } = (rawInput ?? {}) as { appId?: string; projectDir?: string }
    if (!appId || !projectDir) throw new Error('miniapp_open needs an installed app.')
    const { openMiniApp } = await import('@/lib/layout-control')
    const owner = (rawInput as { __layoutOwnerKey?: string } | null)?.__layoutOwnerKey
    return openMiniApp({ sessionId, opener: { kind: 'agent' } }, appId, projectDir, owner ? { key: owner, sessionId, projectPath: projectDir, root: projectDir } : undefined)
  }
  if (op === 'tabPresentation') {
    const { openedTabPresentation } = await import('@/lib/layout-control')
    const owner = (rawInput as { __layoutOwnerKey?: string } | null)?.__layoutOwnerKey ?? sessionId
    return openedTabPresentation(owner, (rawInput as { pip?: unknown } | null)?.pip === true)
  }
  if (op === 'layoutSnapshot' || op === 'layoutAct') {
    const { root, environmentId, request, target } = (rawInput ?? {}) as { root?: string; environmentId?: string; request?: LayoutActRequest; target?: LayoutActRequest['target'] }
    const { layoutActForTarget, layoutSnapshotForTarget } = await import('@/lib/layout-session')
    const caller = { sessionId, environmentId, opener: { kind: 'agent' as const }, ...(root ? { root } : {}) }
    if (op === 'layoutSnapshot') return layoutSnapshotForTarget(caller, target)
    if (!request) throw new Error('layout_act needs an action.')
    return layoutActForTarget(caller, request, signal)
  }
  if (op === 'miniappReload') {
    const appId = String((rawInput as { appId?: unknown } | null)?.appId ?? '')
    return reloadMiniAppTargets(appId, sessionId, signal)
  }
  // Browser ownership belongs to an execution environment as well as a session.
  if (!isMiniAppTargetId(input.tab)) sessionId = (rawInput as { __layoutOwnerKey?: string } | null)?.__layoutOwnerKey ?? sessionId
  if (op === 'open') {
    const url = input.url ?? 'about:blank'
    assertNotMiniAppTarget(input.tab)
    if (input.tab) {
      const existingTab = useBrowserStore.getState().tabs[input.tab]
      if (!existingTab || existingTab.owner !== sessionId) {
        throw new Error(`Browser tab not found in this session: ${input.tab}`)
      }
      if (!isTabAccessibleToAgent(existingTab.profileId)) {
        throw new Error(`Browser tab "${input.tab}" uses a private profile that is not shared with the agent.`)
      }
    }
    const targetId = input.tab ?? `browser-${crypto.randomUUID()}`
    const requestedProfileId = (rawInput as { profileId?: string } | null)?.profileId
    if (!input.tab) recordDockOpener(sessionId, targetId, 'agent')
    openBrowserTab(url, targetId, sessionId, { reveal: false, profileId: requestedProfileId })
    useAgentViewfinderStore.getState().activate(sessionId, 'browser', targetId)
    const store = useBrowserStore.getState()
    store.patch(targetId, { loading: true })
    store.beginAutomation(targetId)
    try {
      await waitForTabRegistered(targetId)
      if ((input.readiness ?? 'load') !== 'none') await waitForLoadStop(targetId)
      store.markAutomationPreviewReady(targetId)
      const tab = useBrowserStore.getState().tabs[targetId]
      const { openedTabPresentation } = await import('@/lib/layout-control')
      return {
        ok: true,
        tab: targetId,
        url: tab?.url ?? url,
        title: tab?.title ?? '',
        profileId: tab?.profileId ?? requestedProfileId,
        presentation: openedTabPresentation(sessionId, true),
      }
    } finally {
      store.endAutomation(targetId)
    }
  }
  if (op === 'ownedWebContentsIds') {
    const ids = ownedTabIds(sessionId)
      .map((id) => webContentsIdForBrowser(id))
      .filter((id): id is number => id != null)
    return { webContentsIds: ids }
  }
  // Handled before the shared beginAutomation block below: that path opens a
  // presentation scope on the target and hands the viewfinder to it, which is the
  // opposite of what closing means — the tab is gone by the time it would end.
  if (op === 'close') {
    // `tab` widens to a list for this op alone, so it is read off the raw input
    // rather than through BaseInput's single-tab shape.
    const requested = (rawInput as { tab?: string | string[] } | null)?.tab
    // A missing or ambiguous single `tab` is a caller error and still throws. A
    // list is best-effort instead: these tabs are independent, so one stale id
    // must not block the rest — unlike browser_act, whose steps share page state.
    if (!Array.isArray(requested)) {
      const target = resolveBrowserId(requested, sessionId)
      closeOwnedTab(sessionId, target)
      return { ok: true, closed: [target], remaining: ownedTabIds(sessionId).length }
    }
    const closed: string[] = []
    const failed: Array<{ tab: string; error: string }> = []
    for (const candidate of requested) {
      try {
        // Resolved per item against the live store, so a duplicate id fails the
        // second time instead of closing an unrelated tab that reused the slot.
        const target = resolveBrowserId(candidate, sessionId)
        closeOwnedTab(sessionId, target)
        closed.push(target)
      } catch (err) {
        failed.push({ tab: candidate, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return {
      ok: failed.length === 0,
      closed,
      ...(failed.length
        ? { error: `${failed.length} of ${requested.length} tabs could not be closed`, failed }
        : {}),
      remaining: ownedTabIds(sessionId).length,
    }
  }
  if (op === 'tabs') {
    const state = useBrowserStore.getState()
    const tabs = [
      ...ownedTabIds(sessionId).map((id) => ({
        tab: id,
        url: state.tabs[id].url,
        title: state.tabs[id].title,
        loading: state.tabs[id].loading,
        profileId: state.tabs[id].profileId,
      })),
      ...listMiniAppTargets(sessionId),
    ]
    return { tabs, count: tabs.length }
  }
  if (isMiniAppTargetId(input.tab)) {
    // Driver bookkeeping before a CDP action: the action's own op reveals the view.
    if (op === 'resolveWebContentsId') return { webContentsId: await miniAppTargetWebContentsId(input.tab, sessionId, signal) }
    const id = await resolveMiniAppTarget(input.tab, sessionId, signal)
    return runViewOp(id, op, input, signal, { targetId: input.tab, sessionId })
  }
  const id = resolveBrowserId(input.tab, sessionId)
  useAgentViewfinderStore.getState().activate(sessionId, 'browser', id)
  const store = useBrowserStore.getState()
  store.beginAutomation(id)
  if (op !== 'navigate') store.markAutomationPreviewReady(id)
  try {
    return await runViewOp(id, op, input, signal, null)
  } finally {
    store.endAutomation(id)
  }
}

/** A development mini-app WebView: no browser tab state, and its Host logs join its console. */
interface MiniAppView {
  targetId: string
  sessionId: string
}

function unsupportedForMiniApp(op: string): never {
  throw new Error(`browser ${op} is not available for mini-app views`)
}

async function waitForCondition(
  id: string,
  input: { selector?: string; selectorGone?: string; text?: string; urlIncludes?: string; timeoutMs?: number },
): Promise<unknown> {
  const timeoutMs = Math.min(input.timeoutMs ?? 15_000, 60_000)
  const start = Date.now()
  const deadline = start + timeoutMs
  const script = waitCheckScript(input)
  while (Date.now() <= deadline) {
    const matched = (await browserExecJs(id, script)) as boolean
    if (matched) return { ok: true, waitedMs: Date.now() - start }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`wait_for timed out after ${timeoutMs}ms`)
}

/** One op against a resolved, registered WebView — a browser tab or a mini-app view. */
async function runViewOp(id: string, op: string, input: BaseInput, signal: AbortSignal | undefined, miniApp: MiniAppView | null): Promise<unknown> {
  switch (op) {
    case 'recordStart': {
      const started = await startBrowserRecording(id, signal)
      // The follow-up actions address the view by the id the agent used, not the registry key.
      return miniApp ? { ...started, tab: miniApp.targetId } : started
    }
    case 'recordStop': {
      if (typeof input.recordingId !== 'string') throw new Error('recordStop requires recordingId')
      return stopBrowserRecording(input.recordingId, id, signal)
    }
    case 'resolveWebContentsId': {
      const webContentsId = webContentsIdForBrowser(id)
      if (webContentsId == null) throw new Error('Browser view is not attached yet')
      return { webContentsId }
    }
    case 'focusView':
      return { ok: focusBrowserWebview(id) }
    case 'resolvePoint': {
      const webContentsId = webContentsIdForBrowser(id)
      if (webContentsId == null) return { ok: false, error: 'Browser view is not attached yet' }
      const point = (await browserExecJs(id, resolvePointScript(input as Parameters<typeof resolvePointScript>[0]))) as Record<string, unknown>
      return { ...point, webContentsId }
    }
    case 'emulateViewport': {
      const emulate = input.reset || input.width == null || input.height == null ? null : { width: input.width, height: input.height }
      useBrowserStore.getState().setEmulation(id, emulate)
      return { ok: true }
    }
    case 'snapshot': {
      const include = input.include?.length ? input.include : ['meta', 'elements', 'console']
      const needsPage = include.some((s) => s === 'meta' || s === 'elements' || s === 'tree' || s === 'text')
      const page = needsPage
        ? ((await browserExecJs(id, snapshotScript({ include, filter: input.filter, max: input.max, depth: input.depth, treeMax: input.treeMax, textMaxChars: input.textMaxChars }))) as Record<string, unknown>)
        : {}
      if (include.includes('console')) page.console = readBrowserConsole(miniApp ? miniAppConsoleKeys(id) : id, input.console ?? {})
      return page
    }
    case 'query':
      return browserExecJs(id, queryScript(input as Parameters<typeof queryScript>[0]))
    case 'inspect':
      return browserExecJs(id, inspectScript(input as { selector: string }))
    case 'click':
      return browserExecJs(id, clickScript(input as Parameters<typeof clickScript>[0]))
    case 'hover':
      return browserExecJs(id, hoverScript(input as Parameters<typeof hoverScript>[0]))
    case 'type':
      return browserExecJs(id, typeScript(input as { text: string }))
    case 'screenshot':
      return captureBrowserScreenshot(id, input.selector, signal)
    case 'navigate': {
      if (miniApp) {
        if (input.action !== 'reload') unsupportedForMiniApp('navigate (only action "reload")')
        await reloadMiniAppView(id, signal)
        return { ok: true, action: 'reload', tab: miniApp.targetId }
      }
      if (input.action) {
        if (input.action === 'back') browserGoBack(id)
        else if (input.action === 'forward') browserGoForward(id)
        else browserReload(id)
      } else {
        browserNavigate(id, resolveNavigateUrl(input as Parameters<typeof resolveNavigateUrl>[0]))
      }
      if ((input.readiness ?? 'load') !== 'none') await waitForLoadStop(id)
      useBrowserStore.getState().markAutomationPreviewReady(id)
      const tab = useBrowserStore.getState().tabs[id]
      return { ok: true, action: input.action ?? 'navigate', url: tab?.url ?? '', title: tab?.title ?? '', loading: tab?.loading ?? false }
    }
    case 'wait_for':
      return waitForCondition(id, input as Parameters<typeof waitForCondition>[1])
    case 'press':
      return browserExecJs(id, pressScript(input as Parameters<typeof pressScript>[0]))
    case 'scroll':
      return browserExecJs(id, scrollScript(input as Parameters<typeof scrollScript>[0]))
    case 'drag': {
      const from = (await browserExecJs(id, resolvePointScript(input.from ?? {}))) as Record<string, unknown>
      if (from.ok === false) throw new Error(String(from.error ?? 'drag source not found'))
      const to = (await browserExecJs(id, resolvePointScript(input.to ?? {}))) as Record<string, unknown>
      if (to.ok === false) throw new Error(String(to.error ?? 'drag target not found'))
      await browserExecJs(id, dragDispatchScript(Number(from.x), Number(from.y), Number(to.x), Number(to.y), {
        steps: input.steps ?? 10,
        holdMs: input.holdMs ?? 0,
        humanize: input.humanize === true,
      }))
      return { ok: true, from: { selector: from.selector, name: from.name }, to: { selector: to.selector, name: to.name } }
    }
    case 'select':
      return browserExecJs(id, selectScript(input as Parameters<typeof selectScript>[0]))
    case 'evaluate': {
      const expr = String(input.expression ?? '')
      const value = await browserExecJs(id, `(async () => { return (${expr}); })()`)
      if (!miniApp && isBlankUrl(useBrowserStore.getState().tabs[id]?.url ?? '')) {
        try {
          const hasCustomBlankContent = await browserExecJs(id, BLANK_PAGE_HAS_CUSTOM_CONTENT_SCRIPT) === true
          useBrowserStore.getState().patch(id, { hasCustomBlankContent })
        } catch {
          // The expression may have started a navigation and destroyed its JS
          // context. Navigation events reset the blank-content flag instead.
        }
      }
      const json = JSON.stringify(value ?? null)
      if (json.length > 5_000_000) throw new Error('Evaluate result exceeds 5MB; narrow the expression')
      return { value: value ?? null }
    }
    default:
      throw new Error(`Unknown browser automation op: ${op}`)
  }
}

/**
 * In-flight calls by id, so the main process can cancel one it stopped waiting
 * for. It sends `cancel` on the same channel when its own timeout fires, so the
 * aborted op unwinds through its cleanup instead of holding state for a caller
 * that is gone.
 */
const inFlightCalls = new Map<string, AbortController>()

export function useBrowserAutomationHost(): void {
  useEffect(() => {
    if (!window.miniapp) return
    return subscribeMiniAppHostLogs()
  }, [])
  useEffect(() => {
    if (!window.browserHost) return
    return window.browserHost.onAutomationCall(async ({ callId, sessionId, op, input }) => {
      if (op === 'cancel') {
        const target = (input as { callId?: string } | null)?.callId
        if (target) inFlightCalls.get(target)?.abort(new Error('Cancelled after the main process timed out'))
        return
      }
      const controller = new AbortController()
      inFlightCalls.set(callId, controller)
      try {
        // The main process holds the guard open across ops it dispatches itself
        // (CDP input never reaches this runtime), so begin/end arrive as their
        // own calls and must not be wrapped in a region of their own.
        if (op === 'focusGuardBegin' || op === 'focusGuardEnd') {
          if (op === 'focusGuardBegin') beginBrowserFocusIsolation()
          else endBrowserFocusIsolation()
          window.browserHost!.sendAutomationResult(callId, true, { ok: true })
          return
        }
        // Every automation op (including focusView no-op / guest el.focus side
        // effects) runs under host focus isolation so background browser work
        // cannot steal the user's composer caret.
        const explicitNavigation = op === 'layoutAct' && (input as { request?: LayoutActRequest } | null)?.request?.action === 'focus_session'
        const run = () => runBrowserOp(sessionId, op, input, controller.signal)
        const result = await (explicitNavigation ? run() : withBrowserFocusIsolation(run))
        window.browserHost!.sendAutomationResult(callId, true, result)
      } catch (err) {
        window.browserHost!.sendAutomationResult(callId, false, undefined, err instanceof Error ? err.message : String(err))
      } finally {
        inFlightCalls.delete(callId)
      }
    })
  }, [])
}
