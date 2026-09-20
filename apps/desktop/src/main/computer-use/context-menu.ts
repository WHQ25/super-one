import { selectNewAppRoot } from './new-root'
import type { PlatformAdapter } from './platform/types'
import type { RootRegistry } from './root-registry'
import { ComputerUseError, type ComputerUseState, type DeliveryMode, type UiAction, type UiRootIdentity } from './types'

/** What opened a menu: the state it was opened from and the actions that did it. */
export interface MenuOpener {
  base: ComputerUseState
  actions: UiAction[]
  delivery: DeliveryMode
}

interface DismissedMenu {
  root: UiRootIdentity
  openedBy: MenuOpener
}

export interface ContextMenuDeps {
  adapter: PlatformAdapter
  roots: RootRegistry
  refreshRoots(): Promise<void>
  delay(ms: number, signal?: AbortSignal): Promise<void>
}

/** How long a replayed opener gets to bring the menu back up. */
const REOPEN_TIMEOUT_MS = 1500
const REOPEN_POLL_MS = 50

/**
 * Context menus read and dismissed.
 *
 * A context menu is the app's own pop-up-level window: it draws above every
 * other window on screen, the user's included, whichever app is in front.
 * Left open while the agent reads it and decides, it sits over what the user
 * is doing for seconds to minutes. So a menu an action opened is read into
 * the successor state and dismissed at once, and the state stays usable: an
 * action or a snapshot on it replays what opened it — the right-click, the
 * press — on the root it came from, binds the reopened menu to the same
 * rootId so the state's refs still resolve, and dismisses it again afterwards
 * unless the action closed it. A menu the user opened themselves is never
 * touched: only one that appeared with an action is taken down.
 */
export class ContextMenuLedger {
  private readonly dismissed = new Map<string, DismissedMenu>()

  constructor(private readonly deps: ContextMenuDeps) {}

  isDismissed(rootId: string): boolean {
    return this.dismissed.has(rootId)
  }

  /** Take down a menu `openedBy` brought up, if the backend can. */
  async dismissOpened(root: UiRootIdentity, rootsBefore: readonly string[], openedBy: MenuOpener): Promise<void> {
    if (root.kind !== 'menu' || !this.deps.adapter.dismissRoot || rootsBefore.includes(root.rootId)) return
    await this.deps.adapter.dismissRoot(root)
    this.dismissed.set(root.rootId, { root, openedBy })
  }

  /** Take a reopened menu down again, if it is still up. */
  async dismissAgain(rootId: string): Promise<void> {
    const entry = this.dismissed.get(rootId)
    if (!entry || !this.deps.adapter.dismissRoot) return
    await this.deps.refreshRoots()
    const live = this.deps.roots.get(rootId)
    if (!live) return
    await this.deps.adapter.dismissRoot(live)
    this.dismissed.set(rootId, { ...entry, root: live })
  }

  /**
   * Bring a dismissed menu back up under its old rootId. The root it was
   * opened from may itself be a dismissed menu (a submenu's parent), which
   * is reopened first.
   */
  async reopen(rootId: string, signal?: AbortSignal): Promise<UiRootIdentity> {
    const entry = this.dismissed.get(rootId)
    if (!entry) throw new ComputerUseError('UNKNOWN_ROOT', `Unknown root ${rootId}`, { rootId })
    const { base, actions, delivery } = entry.openedBy
    const origin = await this.ensureOpen(base.root, signal)
    await this.deps.refreshRoots()
    const rootsBefore = this.deps.roots.list().map((root) => root.rootId)
    await this.deps.adapter.act({ root: origin, actions, delivery, coordinateSpace: base.coordinateSpace, outline: base.outline })
    for (let waited = 0; ; waited += REOPEN_POLL_MS) {
      await this.deps.refreshRoots()
      const reopened = selectNewAppRoot(origin, rootsBefore, this.deps.roots.list(), { kind: 'newRoot', rootKind: 'menu' })
      if (reopened) {
        const rebound = this.deps.roots.rebind(reopened.rootId, rootId)!
        // Still on the ledger: the caller dismisses it again when done with it.
        this.dismissed.set(rootId, { ...entry, root: rebound })
        return rebound
      }
      if (waited >= REOPEN_TIMEOUT_MS) break
      await this.deps.delay(REOPEN_POLL_MS, signal)
    }
    this.dismissed.delete(rootId)
    throw new ComputerUseError('STALE_STATE', `The menu ${rootId} could not be reopened`, { rootId })
  }

  /** The root as it is now: reopened if it is a dismissed menu, else as listed. */
  async ensureOpen(root: UiRootIdentity, signal?: AbortSignal): Promise<UiRootIdentity> {
    if (this.dismissed.has(root.rootId)) return this.reopen(root.rootId, signal)
    await this.deps.refreshRoots()
    return this.deps.roots.get(root.rootId) ?? root
  }
}
