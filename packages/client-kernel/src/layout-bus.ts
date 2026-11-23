import { createDisposer } from './disposer'
import type {
  KernelDisposer,
  LayoutActionResult,
  LayoutAdapter,
  LayoutBus,
  LayoutOpenPanelRequest,
} from './types'

function unsupported(action: string): LayoutActionResult {
  return {
    ok: false,
    unsupported: true,
    code: 'unsupported',
    message: `Layout action "${action}" is not supported in this window`,
  }
}

export function createLayoutBus(): LayoutBus {
  let adapter: LayoutAdapter | null = null

  async function call<Args extends unknown[]>(
    name: keyof LayoutAdapter,
    ...args: Args
  ): Promise<LayoutActionResult> {
    const fn = adapter?.[name] as ((...a: Args) => LayoutActionResult | Promise<LayoutActionResult>) | undefined
    if (!fn) return unsupported(String(name))
    try {
      return await fn(...args)
    } catch (error) {
      return {
        ok: false,
        code: 'error',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    setAdapter(nextAdapter: LayoutAdapter): KernelDisposer {
      const prev = adapter
      adapter = nextAdapter
      return createDisposer(() => {
        if (adapter === nextAdapter) adapter = prev
      })
    },

    openPanel(request: LayoutOpenPanelRequest): Promise<LayoutActionResult> {
      return call('openPanel', request)
    },

    closePanel(panelIdOrKey: string): Promise<LayoutActionResult> {
      return call('closePanel', panelIdOrKey)
    },

    focusPanel(panelIdOrKey: string): Promise<LayoutActionResult> {
      return call('focusPanel', panelIdOrKey)
    },

    toggleSidebar(open?: boolean): Promise<LayoutActionResult> {
      return call('toggleSidebar', open)
    },

    toggleActivityPanel(open?: boolean): Promise<LayoutActionResult> {
      return call('toggleActivityPanel', open)
    },

    focusSession(projectPath: string, sessionId: string): Promise<LayoutActionResult> {
      return call('focusSession', projectPath, sessionId)
    },

    splitSession(
      projectPath: string,
      sessionId: string,
      edge?: 'left' | 'right' | 'top' | 'bottom',
    ): Promise<LayoutActionResult> {
      return call('splitSession', projectPath, sessionId, edge)
    },

    setChatMode(mode: 'docked' | 'floating' | 'icon'): Promise<LayoutActionResult> {
      return call('setChatMode', mode)
    },

    getSnapshot(): unknown {
      return adapter?.getSnapshot?.() ?? null
    },
  }
}
