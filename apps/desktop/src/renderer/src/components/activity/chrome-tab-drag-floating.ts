import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from 'dockview-core'
import { useActivityDropStore, type DropPosition } from '@/stores/activity-drop'
import { useBrowserStore } from '@/stores/browser'
import { resolveFallbackSplitPosition } from './chrome-tab-drag-geometry'

interface RestoreTarget {
  groupId: string
  index: number
  fallbackGroupId: string | null
  fallbackPosition: DropPosition
}

export function getGridGroups(api: DockviewApi): DockviewGroupPanel[] {
  return api.groups.filter((g) => g.api.location.type === 'grid')
}

function buildRestoreTarget(api: DockviewApi, group: DockviewGroupPanel, index: number): RestoreTarget {
  const originRect = group.element.getBoundingClientRect()
  let fallbackGroupId: string | null = null
  let fallbackPosition: DropPosition = 'center'
  for (const other of getGridGroups(api)) {
    if (other.id === group.id) continue
    const pos = resolveFallbackSplitPosition(originRect, other.element.getBoundingClientRect())
    fallbackGroupId = other.id
    fallbackPosition = pos
    if (pos !== 'center') break
  }
  return { groupId: group.id, index, fallbackGroupId, fallbackPosition }
}

function syncFloatingBrowserSlot(overlayEl: HTMLElement | null) {
  if (!overlayEl) return
  const slotEl = overlayEl.querySelector<HTMLElement>('[data-browser-slot]')
  const browserId = slotEl?.getAttribute('data-browser-slot')
  if (!slotEl || !browserId) return
  const r = slotEl.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return
  useBrowserStore.getState().updateSlot(browserId, 'panel', r)
  const hostEl = document.querySelector<HTMLElement>(`[data-browser-host][data-browser-id="${CSS.escape(browserId)}"]`)
  if (hostEl) {
    hostEl.style.left = `${Math.round(r.left)}px`
    hostEl.style.top = `${Math.round(r.top)}px`
    hostEl.style.width = `${Math.round(r.width)}px`
    hostEl.style.height = `${Math.round(r.height)}px`
  }
}

export class FloatingTabDrag {
  private group: DockviewGroupPanel | null = null
  private overlayEl: HTMLElement | null = null
  private portalEl: HTMLElement | null = null
  private originalHost: HTMLElement | null = null
  private restoreTarget: RestoreTarget | null = null
  grabX = 0

  constructor(
    private readonly container: HTMLElement,
    private readonly api: DockviewApi,
    private readonly sourcePanel: IDockviewPanel,
    private readonly grabOffsetY: number,
  ) {}

  get active(): boolean {
    return this.group !== null
  }

  detach(
    originGroup: DockviewGroupPanel,
    originIndex: number,
    tabWidth: number,
    grabOffsetX: number,
    clientX: number,
    clientY: number,
    onBeforeDetach: () => void,
  ): boolean {
    if (getGridGroups(this.api).length <= 1 && originGroup.panels.length <= 1) return false

    const groupRect = originGroup.element.getBoundingClientRect()
    const floatWidth = Math.round(Math.min(Math.max(groupRect.width * 0.68, 280), 440))
    const floatHeight = Math.round(Math.min(Math.max(groupRect.height * 0.56, 200), 340))
    this.grabX = Math.min(grabOffsetX, Math.max(24, Math.min(tabWidth, floatWidth) - 16))
    this.restoreTarget = buildRestoreTarget(this.api, originGroup, originIndex)

    onBeforeDetach()

    const dockEl = this.container.querySelector<HTMLElement>('.dv-dockview') ?? this.container
    const dockRect = dockEl.getBoundingClientRect()
    this.api.addFloatingGroup(this.sourcePanel, {
      x: Math.max(0, clientX - dockRect.left - this.grabX),
      y: Math.max(0, clientY - dockRect.top - this.grabOffsetY),
      width: floatWidth,
      height: floatHeight,
      dragHandle: 'tabbar',
      disableSmartGuides: true,
    })

    this.group = this.sourcePanel.group
    this.overlayEl = this.group.element.closest<HTMLElement>('.dv-resize-container')
    useActivityDropStore.getState().setFloatingPanelId(this.sourcePanel.id)
    if (this.overlayEl) {
      this.originalHost = this.overlayEl.parentElement
      this.portalEl = document.createElement('div')
      this.portalEl.className = 'dockview-theme-superone chrome-floating-drag-layer'
      this.overlayEl.setAttribute('data-chrome-floating-drag', 'true')
      this.portalEl.appendChild(this.overlayEl)
      document.body.appendChild(this.portalEl)
    }
    this.move(clientX, clientY)
    requestAnimationFrame(() => syncFloatingBrowserSlot(this.overlayEl))
    return true
  }

  move(clientX: number, clientY: number) {
    if (!this.overlayEl) return
    this.overlayEl.style.left = `${clientX - this.grabX}px`
    this.overlayEl.style.top = `${clientY - this.grabOffsetY}px`
    this.overlayEl.style.right = 'auto'
    this.overlayEl.style.bottom = 'auto'
    syncFloatingBrowserSlot(this.overlayEl)
  }

  unmount() {
    useActivityDropStore.getState().setFloatingPanelId(null)
    if (this.overlayEl) {
      this.overlayEl.removeAttribute('data-chrome-floating-drag')
      if (this.originalHost?.isConnected && this.overlayEl.parentElement !== this.originalHost) {
        this.originalHost.appendChild(this.overlayEl)
      }
    }
    this.portalEl?.remove()
    this.portalEl = null
    this.originalHost = null
    this.overlayEl = null
    this.group = null
  }

  clearRestoreTarget() {
    this.restoreTarget = null
  }

  restore() {
    if (!this.group && !this.portalEl) return
    this.unmount()

    const gridGroups = getGridGroups(this.api)
    const target = this.restoreTarget
    this.restoreTarget = null
    if (target) {
      const origGroup = gridGroups.find((g) => g.id === target.groupId)
      if (origGroup) {
        this.sourcePanel.api.moveTo({ group: origGroup, index: Math.min(target.index, origGroup.panels.length) })
        return
      }
      const fallbackGroup = gridGroups.find((g) => g.id === target.fallbackGroupId)
      if (fallbackGroup) {
        this.sourcePanel.api.moveTo({ group: fallbackGroup, position: target.fallbackPosition })
        return
      }
    }
    if (gridGroups[0]) {
      this.sourcePanel.api.moveTo({ group: gridGroups[0], position: 'center' })
    }
  }
}
