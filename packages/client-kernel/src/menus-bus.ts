import { createDisposer } from './disposer'
import type {
  CommandsBus,
  KernelDisposer,
  MenuContext,
  MenuId,
  MenuItemDefinition,
  MenusBus,
  ResolvedMenuItem,
} from './types'

interface StoredMenuEntry {
  seq: number
  menuId: string
  item: MenuItemDefinition
}

function compareEntries(a: StoredMenuEntry, b: StoredMenuEntry): number {
  const ga = a.item.group ?? ''
  const gb = b.item.group ?? ''
  if (ga !== gb) return ga.localeCompare(gb)
  const oa = a.item.order ?? 0
  const ob = b.item.order ?? 0
  if (oa !== ob) return oa - ob
  return a.seq - b.seq
}

function resolveMenuTree(
  item: MenuItemDefinition,
  ctx: MenuContext,
  commands: CommandsBus,
): ResolvedMenuItem | null {
  if (item.when && !item.when(ctx)) return null
  const label = typeof item.label === 'function' ? item.label(ctx) : item.label
  const disabled = typeof item.disabled === 'function' ? item.disabled(ctx) : Boolean(item.disabled)
  const submenu = item.submenu
    ? item.submenu
        .map((child) => resolveMenuTree(child, ctx, commands))
        .filter((child): child is ResolvedMenuItem => child !== null)
    : undefined

  return {
    id: item.id,
    label,
    icon: item.icon,
    group: item.group,
    order: item.order ?? 0,
    shortcut: item.shortcut,
    destructive: Boolean(item.destructive),
    disabled,
    onSelect: () => {
      if (disabled) return
      if (item.onSelect) {
        void item.onSelect(ctx)
        return
      }
      if (item.command && commands.hasCommand(item.command)) {
        const args = typeof item.commandArgs === 'function' ? item.commandArgs(ctx) : (item.commandArgs ?? [ctx])
        void commands.executeCommand(item.command, ...args)
      }
    },
    ...(submenu ? { submenu } : {}),
  }
}

export function createMenusBus(commands: CommandsBus): MenusBus {
  let nextSeq = 1
  let version = 0
  const versionByMenu = new Map<string, number>()
  const entriesByMenu = new Map<string, StoredMenuEntry[]>()
  const menuListeners = new Map<string, Set<() => void>>()
  const globalListeners = new Set<() => void>()

  function notify(menuId: string) {
    version++
    versionByMenu.set(menuId, (versionByMenu.get(menuId) ?? 0) + 1)
    const listeners = menuListeners.get(menuId)
    if (listeners) {
      for (const listener of [...listeners]) listener()
    }
    for (const listener of [...globalListeners]) listener()
  }

  return {
    registerMenuItem(menuId: MenuId, item: MenuItemDefinition): KernelDisposer {
      const entry: StoredMenuEntry = { seq: nextSeq++, menuId, item }
      let list = entriesByMenu.get(menuId)
      if (!list) {
        list = []
        entriesByMenu.set(menuId, list)
      }
      list.push(entry)
      notify(menuId)
      return createDisposer(() => {
        const current = entriesByMenu.get(menuId)
        if (!current) return
        const idx = current.indexOf(entry)
        if (idx >= 0) current.splice(idx, 1)
        if (current.length === 0) entriesByMenu.delete(menuId)
        notify(menuId)
      })
    },

    getMenuItems(menuId: MenuId, ctx: MenuContext): readonly ResolvedMenuItem[] {
      const list = entriesByMenu.get(menuId)
      if (!list || list.length === 0) return []
      const sorted = [...list].sort(compareEntries)
      const resolved: ResolvedMenuItem[] = []
      for (const entry of sorted) {
        const item = resolveMenuTree(entry.item, ctx, commands)
        if (item) resolved.push(item)
      }
      return resolved
    },

    getVersion(menuId?: MenuId): number {
      return menuId ? (versionByMenu.get(menuId) ?? 0) : version
    },

    subscribe(listener: () => void): () => void {
      globalListeners.add(listener)
      return () => {
        globalListeners.delete(listener)
      }
    },

    subscribeMenu(menuId: MenuId, listener: () => void): () => void {
      let set = menuListeners.get(menuId)
      if (!set) {
        set = new Set()
        menuListeners.set(menuId, set)
      }
      set.add(listener)
      return () => {
        set?.delete(listener)
        if (set?.size === 0) menuListeners.delete(menuId)
      }
    },
  }
}
