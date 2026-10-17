import { LayoutControlError, type LayoutActRequest, type LayoutActResult, type LayoutBox, type SessionLayoutSnapshot } from '@superone/shared/layout-control'
import type { SessionRef } from '@superone/shared/environment/refs'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useMosaicStore, mosaicTileId } from '@/components/mosaic/mosaic-store'
import { collectLeaves, findLeaf, makeLeaf, addLeaf, removeLeafRebalanced, replaceLeaf, MIN_TILE_W, MIN_TILE_H, DIVIDER_SIZE, type MosaicLeaf, type MosaicNode } from '@/components/mosaic/mosaic-tree'
import { arrangeMosaic, assertMosaicFits, mosaicCapacity, mosaicGeometry, mosaicDividers, resizeMosaic } from '@/components/mosaic/mosaic-geometry'
import { projectSessionKey } from '@superone/shared/remote-resource-key'
import { leafRectRel, visibleMosaicDom } from '@/components/mosaic/mosaic-dom'
import { useWindowMiniModeStore } from '@/stores/window-mini-mode'
import { explicitMosaicLayout } from '@/components/mosaic/mosaic-explicit-layout'

export const MOSAIC_ACTIONS = new Set(['split_session', 'close_split', 'maximize_split', 'restore_splits', 'resize_splits'])
export type ResolvedLayoutSession = { ref: SessionRef; projectPath: string }

function mosaicOnScreen(): boolean {
  const phase = useWindowMiniModeStore.getState().phase
  return useMosaicStore.getState().mode === 'mosaic' && phase !== 'mini' && phase !== 'unfolding'
}

/** The card's actual content box already excludes the sidebar, borders and window margins.
 * The activity panel/header are hidden in mosaic, so reserve none of their single-view area. */
export function availableMosaicArea(required = true): LayoutBox {
  const el = document.querySelector<HTMLElement>('[data-main-content]')
  const rect = el?.getBoundingClientRect()
  if (!el || !rect || rect.width <= 0 || rect.height <= 0) {
    if (!required) return { x: 0, y: 0, width: 0, height: 0 }
    throw new LayoutControlError('unavailable', 'Workspace geometry is not ready. Open the main workspace and call layout_snapshot again.')
  }
  const x = Math.max(0, rect.x + el.clientLeft)
  const y = Math.max(0, rect.y + el.clientTop)
  return { x, y, width: Math.max(0, Math.min(window.innerWidth, rect.x + rect.width - el.clientLeft) - x),
    height: Math.max(0, Math.min(window.innerHeight, rect.y + rect.height - el.clientTop) - y) }
}

export function foregroundLeaf(): MosaicLeaf | null {
  const mosaic = useMosaicStore.getState()
  if (mosaic.mode === 'mosaic' && mosaic.root) return findLeaf(mosaic.root, mosaic.focusedTileId ?? '') ?? collectLeaves(mosaic.root)[0] ?? null
  const chat = useChatStore.getState()
  const project = chat.activeProject
  const sid = project ? chat.projectSessions[project]?._activeSessionId : null
  return project && sid ? makeLeaf(mosaicTileId(project, sid), project, sid) : null
}

/** Match the UI restore rule: single navigation owns the saved focused slot. */
export function restorableRoot(): MosaicNode | null {
  const st = useMosaicStore.getState()
  if (st.mode === 'mosaic') return st.root
  const saved = st.lastLayout
  if (!saved) return null
  const active = foregroundLeaf()
  if (!active || findLeaf(saved.root, active.id)) return saved.root
  const slot = findLeaf(saved.root, saved.focusedTileId ?? '') ?? collectLeaves(saved.root)[0]
  return slot ? replaceLeaf(saved.root, slot.id, active) : saved.root
}

export async function sessionLayoutSnapshot(): Promise<SessionLayoutSnapshot> {
  // Let React commit an action's tree before reading DOM. Background windows may
  // pause animation frames, so the timer also bounds this read.
  await new Promise<void>(resolve => {
    let frame: number | undefined
    const timer = setTimeout(() => { if (frame !== undefined) cancelAnimationFrame(frame); resolve() }, 32)
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(() => { clearTimeout(timer); resolve() })
  })
  const st = useMosaicStore.getState()
  const area = availableMosaicArea(false)
  const current = foregroundLeaf()
  const visible = useAppStore.getState().view === 'main' && area.width > 0 && area.height > 0
  const mosaicVisible = mosaicOnScreen()
  const root = mosaicVisible ? st.root : current
  const saved = mosaicVisible ? null : restorableRoot()
  const container = root && mosaicVisible ? visibleMosaicDom(root) : null
  const ref = async (leaf: MosaicLeaf): Promise<SessionRef> => {
    const environmentId = await window.environment.sessionSource(leaf.projectPath)
    if (!environmentId) throw new LayoutControlError('unavailable', 'Session environment is unavailable.')
    return { environmentId, sessionId: leaf.sessionId }
  }
  const geometry = root ? mosaicGeometry(root, area) : { tiles: [], dividers: [] }
  // A single pane may share the card with a panel, header or terminal. Measure it
  // instead of reporting its hypothetical full-card mosaic slot as visible.
  const singleHost = !mosaicVisible ? document.querySelector<HTMLElement>('[data-layout-single]') : null
  const singleBox = singleHost?.getBoundingClientRect()
  const floatingBox = !mosaicVisible ? document.querySelector<HTMLElement>('[data-chat-panel]')?.getBoundingClientRect() : null
  const single = singleBox?.width && singleBox.height ? singleBox : floatingBox
  const tiles = await Promise.all(geometry.tiles.map(async ({ leaf, ...box }) => ({ id: leaf.id, session: await ref(leaf),
    ...box, ...(() => {
      const measured = container ? leafRectRel(container, leaf.id) : null
      if (measured) {
        const r = container!.getBoundingClientRect()
        return { x: r.x - area.x + measured.x, y: r.y - area.y + measured.y, width: measured.w, height: measured.h }
      }
      return single && single.width > 0 && single.height > 0 ? { x: single.x - area.x, y: single.y - area.y, width: single.width, height: single.height } : {}
    })() })))
  const paths = new Map(root ? mosaicDividers(root).map(d => [d.id, d.path.join('/')]) : [])
  const dividers = geometry.dividers.map(d => {
    const path = paths.get(d.id)
    const el = container?.querySelector<HTMLElement>(`[data-mosaic-path="${path}"]`)
    const r = el?.getBoundingClientRect()
    return r ? { ...d, x: r.x - area.x, y: r.y - area.y, width: r.width, height: r.height } : d
  })
  return { mode: mosaicVisible ? 'mosaic' : saved ? 'maximized' : 'single', area,
    minTile: { width: MIN_TILE_W, height: MIN_TILE_H }, dividerSize: DIVIDER_SIZE, maxSessions: mosaicCapacity(area),
    focusedSession: current ? await ref(current) : null,
    tiles: visible && (mosaicVisible || !singleHost || (single && single.width > 0 && single.height > 0)) ? tiles : [], dividers: visible && mosaicVisible ? dividers : [],
    ...(saved ? { saved: { tiles: await Promise.all(collectLeaves(saved).map(async leaf => ({ id: leaf.id, session: await ref(leaf) }))),
      dividers: mosaicDividers(saved).map(({ id, direction, ratio }) => ({ id, direction, ratio })) } } : {}) }
}

export function validateMosaicRequest(request: LayoutActRequest): void {
  const { sessionIds, sessionId, closeAll, action } = request
  if (request.layout !== undefined && (action !== 'split_session' || sessionIds === undefined)) {
    throw new LayoutControlError('invalid', 'layout is only supported with split_session and sessionIds.')
  }
  if (sessionIds !== undefined && (!Array.isArray(sessionIds) || !sessionIds.length)) throw new LayoutControlError('invalid', 'sessionIds must be a non-empty list.')
  if (sessionIds !== undefined && (sessionId !== undefined || (action === 'split_session' && request.direction !== undefined))) {
    throw new LayoutControlError('invalid', 'sessionIds cannot be combined with sessionId or a split direction.')
  }
  if (closeAll !== undefined && (action !== 'close_split' || typeof closeAll !== 'boolean')) throw new LayoutControlError('invalid', 'closeAll is a boolean for close_split only.')
  if (closeAll && (sessionId !== undefined || sessionIds !== undefined || request.sessionEnvironmentId !== undefined)) throw new LayoutControlError('invalid', 'closeAll cannot be combined with explicit session identities.')
  if ((action === 'split_session' || action === 'close_split') && !closeAll && sessionIds === undefined && !sessionId) {
    throw new LayoutControlError('invalid', `${action} needs sessionId or sessionIds${action === 'close_split' ? ', or closeAll: true' : ''}.`)
  }
  if (action === 'split_session' && sessionIds === undefined && request.direction !== undefined && !['left', 'right', 'up', 'down'].includes(request.direction)) throw new LayoutControlError('invalid', 'split_session direction must be right, down, left or up.')
}

/** Resolution and navigation fencing belong to layout-session; this function commits no partial tree. */
export async function applyMosaicAction(request: LayoutActRequest, target: ResolvedLayoutSession, peers: ResolvedLayoutSession[], navigation?: {
  stale: () => boolean
  beginCommit: (target: { projectPath: string; sessionId: string }) => void
}): Promise<LayoutActResult> {
  const st = useMosaicStore.getState()
  const current = foregroundLeaf()
  const root = restorableRoot()
  if (request.action === 'maximize_split' && !root) throw new LayoutControlError('unavailable', 'maximize_split requires a split layout or a saved split layout. Use split_session first.')
  const targetKey = projectSessionKey(target.projectPath, target.ref.sessionId)
  const displayed = mosaicOnScreen() && st.root ? collectLeaves(st.root) : current ? [current] : []
  // Maximize explicitly navigates to a displayed tile. Other operations may not
  // grant a hidden caller window control merely because it occurs in a saved tree.
  if (useAppStore.getState().view !== 'main' || (!displayed.some(t => projectSessionKey(t.projectPath, t.sessionId) === targetKey)
    && !(request.action === 'maximize_split' && root && collectLeaves(root).some(t => projectSessionKey(t.projectPath, t.sessionId) === targetKey)))) {
    return { status: 'skipped', visible: false, reason: 'not_visible' }
  }
  if (useWindowMiniModeStore.getState().phase !== 'app' && ['split_session', 'restore_splits', 'resize_splits'].includes(request.action)) {
    throw new LayoutControlError('unavailable', 'Restore the full window before arranging mosaic sessions or dividers.')
  }
  const area = availableMosaicArea() // execution-time geometry, after all awaits
  let next = root
  let focus = current?.id
  let maximized = st.mode === 'single' && !!st.lastLayout
  let reflow: (() => MosaicNode) | undefined
  if (request.action === 'split_session') {
    const leaves = peers.map(p => makeLeaf(mosaicTileId(p.projectPath, p.ref.sessionId), p.projectPath, p.ref.sessionId))
    if (request.sessionIds !== undefined) {
      if (request.layout !== undefined) {
        next = explicitMosaicLayout(request.layout, leaves)
        assertMosaicFits(next, area)
      } else {
        next = arrangeMosaic(leaves, area)
        reflow = () => arrangeMosaic(leaves, availableMosaicArea())
      }
      focus = leaves.find(l => l.id === current?.id)?.id ?? leaves[0]!.id
    } else {
      const leaf = leaves[0]!
      if (projectSessionKey(leaf.projectPath, leaf.sessionId) === targetKey) throw new LayoutControlError('invalid', 'sessionId must be another session, not your own.')
      next = st.mode === 'mosaic' ? root : current
      if (!next) throw new LayoutControlError('unavailable', 'No session on screen to split.')
      if (!findLeaf(next, leaf.id)) {
        const own = collectLeaves(next).find(t => projectSessionKey(t.projectPath, t.sessionId) === targetKey)!
        const edges = { right: 'right', left: 'left', up: 'top', down: 'bottom' } as const
        next = addLeaf(next, own.id, edges[(request.direction ?? 'right') as keyof typeof edges], leaf)
      }
      assertMosaicFits(next, area)
    }
    maximized = false
  } else if (request.action === 'close_split') {
    if (!root) {
      if (!request.closeAll) throw new LayoutControlError('unavailable', 'There is no split layout to close.')
      if (current) await st.applyLayout(current, current.id)
      return { status: 'applied', visible: document.visibilityState === 'visible' }
    }
    if (request.closeAll) next = current
    else {
      const leaves = peers.map(peer => collectLeaves(root).find(l => l.projectPath === peer.projectPath && l.sessionId === peer.ref.sessionId))
      if (leaves.some(l => !l)) throw new LayoutControlError('not_found', 'A requested session is not in the current or saved split layout. Read layout_snapshot for tile identities.')
      for (const leaf of leaves) next = next ? removeLeafRebalanced(next, leaf!.id) : null
      // Explicitly closing all tiles retains the user's selected session.
      next ??= current
    }
    focus = next && current && findLeaf(next, current.id) ? current.id : collectLeaves(next)[0]?.id
  } else if (request.action === 'maximize_split') {
    if (!root) throw new LayoutControlError('unavailable', 'maximize_split requires a split layout or a saved split layout. Use split_session first.')
    const leaf = collectLeaves(root).find(t => projectSessionKey(t.projectPath, t.sessionId) === targetKey)
    if (!leaf) throw new LayoutControlError('not_found', 'The requested session is not a split tile.')
    focus = leaf.id
    maximized = true
  } else if (request.action === 'restore_splits') {
    if (!root || st.mode === 'mosaic') return { status: 'applied', visible: document.visibilityState === 'visible' }
    assertMosaicFits(root, area)
    maximized = false
  } else if (request.action === 'resize_splits') {
    if (!root || st.mode !== 'mosaic') throw new LayoutControlError('unavailable', 'Restore a visible mosaic before resizing its dividers.')
    next = resizeMosaic(root, request.dividers!, area)
  }
  if (!next || !focus) throw new LayoutControlError('unavailable', 'No session layout is available.')
  const proposed = next
  const focused = findLeaf(proposed, focus)!
  navigation?.beginCommit(focused)
  const applied = await st.applyLayout(proposed, focus, maximized, {
    canApply: () => !navigation?.stale(),
    prepare: () => {
      if (reflow) return reflow()
      if (['split_session', 'restore_splits', 'resize_splits'].includes(request.action)) assertMosaicFits(proposed, availableMosaicArea())
      return proposed
    },
  })
  return applied ? { status: 'applied', visible: document.visibilityState === 'visible' } : { status: 'skipped', visible: false, reason: 'superseded' }
}
