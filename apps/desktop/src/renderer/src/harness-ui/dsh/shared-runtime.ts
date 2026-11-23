import { useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useActiveSession, useChatStore, useSessionScope } from '@/stores/chat'
import { useSessionTitle } from '@/hooks/useSessionTitle'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { closePluginPanelTab, openPluginPanelTab } from '@/components/activity/activity-panel-api'

let initialized = false

function subscribeDocumentTheme(listener: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }
  const observer = new MutationObserver(() => listener())
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

function getDocumentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export async function ensureSuperoneShared(): Promise<Record<string, unknown>> {
  const g = globalThis as { __SUPERONE_SHARED__?: Record<string, unknown> }
  if (initialized && g.__SUPERONE_SHARED__) {
    return g.__SUPERONE_SHARED__
  }

  const [
    react,
    reactDom,
    reactDomClient,
    jsxRuntime,
    jsxDevRuntime,
    zustand,
    uiSlots,
    uiSlotsReact,
    clientKernel,
    clientKernelReact,
    pluginSdk,
    uiButton,
    uiBadge,
    uiUtils,
  ] = await Promise.all([
    import('react'),
    import('react-dom'),
    import('react-dom/client'),
    import('react/jsx-runtime'),
    import('react/jsx-dev-runtime'),
    import('zustand'),
    import('@superone/ui-slots'),
    import('@superone/ui-slots/react'),
    import('@superone/client-kernel'),
    import('@superone/client-kernel/react'),
    import('@superone/plugin-sdk'),
    import('@superone/ui/components/ui/button'),
    import('@superone/ui/components/ui/badge'),
    import('@superone/ui/lib/utils'),
  ])

  pluginSdk.setPluginSdkHostAdapter({
    useSession: () => {
      const scope = useSessionScope()
      const activeProject = useChatStore((s) => s.activeProject)
      const base = useActiveSession(
        useShallow((s) => ({
          sessionId: scope?.sessionId ?? s._activeSessionId ?? null,
          projectPath: scope?.projectPath ?? activeProject ?? null,
          provider: resolveProvider({
            sessionProvider: s.sessionProvider,
            preferredProvider: s.preferredProvider,
          }),
          status: s.status ?? null,
        })),
      )
      const title = useSessionTitle(base.projectPath, base.sessionId)
      return { ...base, title: title || null }
    },
    useTheme: () => ({
      resolvedTheme: useSyncExternalStore(subscribeDocumentTheme, getDocumentTheme, () => 'dark'),
    }),
    openPanel: (panelKey, title, params) => openPluginPanelTab(panelKey, title, params),
    closePanel: (panelKey) => closePluginPanelTab(panelKey),
  })

  const shared = Object.freeze({
    react,
    'react-dom': reactDom,
    'react-dom/client': reactDomClient,
    'react/jsx-runtime': jsxRuntime,
    'react/jsx-dev-runtime': jsxDevRuntime,
    zustand,
    '@superone/ui-slots': uiSlots,
    '@superone/ui-slots/react': uiSlotsReact,
    '@superone/client-kernel': clientKernel,
    '@superone/client-kernel/react': clientKernelReact,
    '@superone/plugin-sdk': pluginSdk,
    '@superone/ui/components/ui/button': uiButton,
    '@superone/ui/components/ui/badge': uiBadge,
    '@superone/ui/lib/utils': uiUtils,
  })

  g.__SUPERONE_SHARED__ = shared
  initialized = true
  return shared
}

export function resetSuperoneSharedForTest(): void {
  initialized = false
  delete (globalThis as { __SUPERONE_SHARED__?: unknown }).__SUPERONE_SHARED__
}
