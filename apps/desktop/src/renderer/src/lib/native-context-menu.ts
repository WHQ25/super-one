import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NativeContextMenuItemSpec } from '@superone/shared/agent-types'

export type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number; className?: string }>

export type AdaptiveMenuEntry =
  | { kind: 'separator' }
  | {
      kind: 'item'
      id: string
      label: string
      icon?: IconComponent
      destructive?: boolean
      disabled?: boolean
      onSelect: () => void
    }
  | {
      kind: 'submenu'
      id: string
      label: string
      icon?: IconComponent
      items: AdaptiveMenuEntry[]
    }

export function toNativeMenu(entries: AdaptiveMenuEntry[]): NativeMenuItem[] {
  return entries.map((entry) => {
    if (entry.kind === 'separator') return { type: 'separator' }
    if (entry.kind === 'submenu') {
      return {
        id: entry.id,
        label: entry.label,
        type: 'submenu',
        icon: entry.icon,
        submenu: toNativeMenu(entry.items),
      }
    }
    return {
      id: entry.id,
      label: entry.label,
      icon: entry.icon,
      enabled: !entry.disabled,
      onSelect: entry.onSelect,
    }
  })
}

export interface NativeMenuItem {
  id?: string
  label?: string
  type?: 'normal' | 'separator' | 'submenu'
  enabled?: boolean
  icon?: IconComponent
  onSelect?: () => void
  submenu?: NativeMenuItem[]
}

const ICON_PX = 24
const iconCache = new Map<IconComponent, Promise<string | undefined>>()

function rasterizeIcon(Icon: IconComponent): Promise<string | undefined> {
  const cached = iconCache.get(Icon)
  if (cached) return cached

  const promise = new Promise<string | undefined>((resolve) => {
    const svg = renderToStaticMarkup(createElement(Icon, { size: ICON_PX, color: 'black', strokeWidth: 2 }))
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = ICON_PX
      canvas.height = ICON_PX
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(undefined)
      ctx.drawImage(img, 0, 0, ICON_PX, ICON_PX)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => resolve(undefined)
    img.src = `data:image/svg+xml;base64,${btoa(svg)}`
  })

  iconCache.set(Icon, promise)
  return promise
}

export async function showNativeContextMenu(items: NativeMenuItem[]): Promise<void> {
  const handlers = new Map<string, () => void>()
  let autoId = 0

  const toSpec = async (list: NativeMenuItem[]): Promise<NativeContextMenuItemSpec[]> =>
    Promise.all(
      list.map(async (item) => {
        if (item.type === 'separator') return { type: 'separator' as const }
        const id = item.id ?? `__item_${autoId++}`
        if (item.onSelect) handlers.set(id, item.onSelect)
        return {
          id,
          label: item.label,
          type: item.submenu ? ('submenu' as const) : ('normal' as const),
          enabled: item.enabled,
          iconDataUrl: item.icon ? await rasterizeIcon(item.icon) : undefined,
          submenu: item.submenu ? await toSpec(item.submenu) : undefined,
        }
      }),
    )

  const spec = await toSpec(items)
  const chosen = await window.app.showContextMenu(spec)
  if (chosen) handlers.get(chosen)?.()
}
