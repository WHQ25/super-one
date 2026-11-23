import { createClientKernel, type ClientKernel, type KeybindingContext, type KeybindingFocusArea, type LayoutAdapter } from '@superone/client-kernel'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { getAppSlotRegistry, resetAppSlotRegistryForTest } from '@/lib/ui-slots'
import { ensureBuiltinClientPlugins, disposeBuiltinClientPlugins } from '@/lib/builtin-plugins'
import { useAppStore } from '@/stores/app'
import { useChatStore, lastTouchedPane, type SessionScope } from '@/stores/chat'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'

let appClientKernel: ClientKernel | null = null
let miniWindowClientKernel: ClientKernel | null = null

export function getAppClientKernel(): ClientKernel {
  if (!appClientKernel) {
    appClientKernel = createClientKernel({ slots: getAppSlotRegistry() })
    ensureBuiltinClientPlugins(appClientKernel)
  }
  return appClientKernel
}

export function getMiniWindowClientKernel(): ClientKernel {
  if (!miniWindowClientKernel) {
    miniWindowClientKernel = createClientKernel()
  }
  return miniWindowClientKernel
}

export function resetAppClientKernelForTest(): void {
  if (appClientKernel) {
    disposeBuiltinClientPlugins(appClientKernel)
    appClientKernel.dispose()
    appClientKernel = null
  }
  miniWindowClientKernel?.dispose()
  miniWindowClientKernel = null
  resetAppSlotRegistryForTest()
}

function resolveSessionScopeFromEvent(event: KeyboardEvent | null): SessionScope | undefined {
  const el = (event?.target as Element | null)?.closest?.('[data-scope-session]')
  if (el instanceof HTMLElement) {
    const { scopeProject, scopeSession } = el.dataset
    if (scopeProject && scopeSession) return { projectPath: scopeProject, sessionId: scopeSession }
  }
  const remembered = lastTouchedPane()
  if (remembered) {
    const project = useChatStore.getState().projectSessions[remembered.projectPath]
    if (project?._sessions[remembered.sessionId]) return remembered
  }
  const state = useChatStore.getState()
  const activeProject = state.activeProject
  const activeSessionId = activeProject ? state.projectSessions[activeProject]?._activeSessionId : null
  if (activeProject && activeSessionId) {
    return { projectPath: activeProject, sessionId: activeSessionId }
  }
  return undefined
}

function detectFocusArea(target: Element | null): {
  inTerminal: boolean
  inInput: boolean
  inActivity: boolean
  focusArea: KeybindingFocusArea
} {
  const inTerminal = Boolean(target?.closest('.xterm'))
  const inActivity = Boolean(target?.closest('[data-activity-inner],[data-browser-host],[data-miniapp-host]'))
  const inInput = Boolean(
    target?.closest('input, textarea, [contenteditable="true"], .ProseMirror, .cm-editor'),
  )
  const inChat = Boolean(target?.closest('[data-chat-root],[data-scope-session]'))

  let focusArea: KeybindingFocusArea = 'global'
  if (inTerminal) focusArea = 'xterm'
  else if (target?.closest('.cm-editor')) focusArea = 'editor'
  else if (inInput) focusArea = 'input'
  else if (inActivity) focusArea = 'activity'
  else if (inChat) focusArea = 'chat'

  return { inTerminal, inInput, inActivity, focusArea }
}

export function createKeybindingContextFromEvent(event: KeyboardEvent | null): KeybindingContext {
  const target = (event?.target instanceof Element ? event.target : null)
    ?? (typeof document !== 'undefined' && document.activeElement instanceof Element ? document.activeElement : null)
  const scope = resolveSessionScopeFromEvent(event)
  const app = useAppStore.getState()
  const chat = useChatStore.getState()
  const session = scope
    ? chat.projectSessions[scope.projectPath]?._sessions[scope.sessionId]
    : undefined
  const provider = session
    ? resolveProvider({ sessionProvider: session.sessionProvider, preferredProvider: session.preferredProvider })
    : undefined
  const supportsUiPlugins = provider ? HARNESS_CAPABILITIES[provider].supportsUiPlugins : false
  const area = detectFocusArea(target)

  return {
    view: app.view,
    sessionId: scope?.sessionId,
    projectPath: scope?.projectPath ?? null,
    provider,
    supportsUiPlugins,
    inTerminal: area.inTerminal,
    inInput: area.inInput,
    inActivity: area.inActivity,
    focusArea: area.focusArea,
    hasPendingPlanApproval: Boolean(session?.pendingPlanApproval),
  }
}

export function bindDesktopLayoutAdapter(kernel: ClientKernel): () => void {
  const adapter: LayoutAdapter = {
    async openPanel(request) {
      const api = await import('@/components/activity/activity-panel-api')
      const { useMosaicStore } = await import('@/components/mosaic/mosaic-store')
      if (useMosaicStore.getState().mode === 'mosaic') {
        return { ok: false, code: 'unavailable', message: 'Cannot open dock panels while split mosaic view is active' }
      }
      if (request.component === 'review') {
        const folder = useAppStore.getState().currentFolder
        if (!folder) return { ok: false, code: 'unavailable', message: 'No project folder selected' }
        api.openReviewTab({
          projectPath: folder,
          sessionId: typeof request.params?.sessionId === 'string' ? request.params.sessionId : undefined,
          label: request.title,
        })
        return { ok: true, data: { tab: 'review-tab' } }
      }
      if (request.component === 'trajectory') {
        const sid = typeof request.params?.sessionId === 'string' ? request.params.sessionId : undefined
        if (!sid) return { ok: false, code: 'unavailable', message: 'Session id is required for trajectory panel' }
        api.openTrajectoryTab(sid, request.title)
        return { ok: true, data: { tab: `trajectory-${sid}` } }
      }
      api.openPluginPanelTab(request.panelKey, request.title, request.params)
      return { ok: true, data: { tab: api.pluginPanelId(request.panelKey) } }
    },
    async closePanel(panelIdOrKey) {
      const api = await import('@/components/activity/activity-panel-api')
      api.closePluginPanelTab(panelIdOrKey)
      api.closeActivityTab(panelIdOrKey)
      return { ok: true }
    },
    async focusPanel(panelIdOrKey) {
      const api = await import('@/components/activity/activity-panel-api')
      const focused = api.focusActivityTab(panelIdOrKey) || api.focusActivityTab(api.pluginPanelId(panelIdOrKey))
      return focused
        ? { ok: true }
        : { ok: false, code: 'not_found', message: `Panel "${panelIdOrKey}" was not found` }
    },
    async toggleSidebar(open) {
      const { showSidebar } = useAppStore.getState()
      const { toggleSidebar } = await import('@/lib/layout-actions')
      if (open === undefined || open !== showSidebar) {
        toggleSidebar()
      }
      return { ok: true }
    },
    async toggleActivityPanel(open) {
      const { setActivityPanelShown } = await import('@/lib/layout-actions')
      const { useActivityPanelStore } = await import('@/stores/activity-panel')
      const next = open ?? !useActivityPanelStore.getState().showPanel
      setActivityPanelShown(next)
      return { ok: true }
    },
    async focusSession(projectPath, sessionId) {
      await useChatStore.getState().switchToSession(projectPath, sessionId)
      return { ok: true }
    },
    async splitSession(projectPath, sessionId, edge = 'right') {
      const { useMosaicStore } = await import('@/components/mosaic/mosaic-store')
      useMosaicStore.getState().addTile(projectPath, sessionId, { edge })
      return { ok: true }
    },
    async setChatMode(mode) {
      const { setChatFloating } = await import('@/lib/layout-actions')
      setChatFloating(mode !== 'docked', { expanded: mode === 'floating' })
      if (mode === 'icon') useChatStore.setState({ isOpen: false })
      return { ok: true }
    },
    getSnapshot() {
      return {
        view: useAppStore.getState().view,
        activeProject: useAppStore.getState().currentFolder,
      }
    },
  }
  return kernel.layout.setAdapter(adapter)
}

export function bindMiniWindowLayoutAdapter(kernel: ClientKernel): () => void {
  const unsupportedAction = (action: string) => ({
    ok: false as const,
    unsupported: true,
    code: 'unsupported' as const,
    message: `Layout action "${action}" is not supported in mini window`,
  })
  return kernel.layout.setAdapter({
    openPanel: () => unsupportedAction('openPanel'),
    closePanel: () => unsupportedAction('closePanel'),
    focusPanel: () => unsupportedAction('focusPanel'),
    toggleSidebar: () => unsupportedAction('toggleSidebar'),
    toggleActivityPanel: () => unsupportedAction('toggleActivityPanel'),
    splitSession: () => unsupportedAction('splitSession'),
    setChatMode: () => unsupportedAction('setChatMode'),
    getSnapshot: () => ({ windowMode: 'mini' }),
  })
}
