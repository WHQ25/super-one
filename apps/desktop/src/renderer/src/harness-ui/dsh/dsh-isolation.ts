import type {
  KernelDisposer,
  KernelScope,
  KeybindingDefinition,
  MenuId,
  MenuItemDefinition,
  ThemeLayerDefinition,
} from '@superone/client-kernel'
import type { SlotDisposer, SlotScopeHandle } from '@superone/ui-slots'

const GLOBAL_SHELL_SLOTS = new Set([
  'shell.sidebar.content',
  'shell.titlebar.content',
  'shell.activity.content',
])

const NOOP_DISPOSER: SlotDisposer = Object.assign(() => {}, {
  dispose: () => {},
  [Symbol.dispose]: () => {},
})

function isSlotAllowed(slot: string, isGlobalShellAllowed: () => boolean): boolean {
  if (GLOBAL_SHELL_SLOTS.has(slot)) {
    return isGlobalShellAllowed()
  }
  return true
}

function wrapMenuItemForDsh(item: MenuItemDefinition): MenuItemDefinition {
  const originalWhen = item.when
  return {
    ...item,
    when: (ctx) => ctx.supportsUiPlugins === true && (originalWhen ? originalWhen(ctx) : true),
    ...(item.submenu ? { submenu: item.submenu.map(wrapMenuItemForDsh) } : {}),
  }
}

export function createIsolatedDshSlotScope(
  inner: SlotScopeHandle,
  options: { isGlobalShellAllowed: () => boolean; pluginId?: string; onBlocked?: (slot: string) => void },
): SlotScopeHandle {
  const check = (slot: string): boolean => {
    if (isSlotAllowed(slot, options.isGlobalShellAllowed)) return true
    options.onBlocked?.(slot)
    return false
  }

  return {
    registerSingle(slot, entry) {
      if (!check(String(slot))) return NOOP_DISPOSER
      return inner.registerSingle(slot, entry)
    },
    registerList(slot, entry) {
      if (!check(String(slot))) return NOOP_DISPOSER
      return inner.registerList(slot, entry)
    },
    registerKeyed(slot, key, entry) {
      if (!check(String(slot))) return NOOP_DISPOSER
      return inner.registerKeyed(slot, key, entry)
    },
    registerChain(slot, entry) {
      if (!check(String(slot))) return NOOP_DISPOSER
      return inner.registerChain(slot, entry)
    },
    registerHoc(slot, entry) {
      if (!check(String(slot))) return NOOP_DISPOSER
      return inner.registerHoc(slot, entry)
    },
    createScope() {
      return createIsolatedDshSlotScope(inner.createScope(), options)
    },
    onDispose(fn) {
      return inner.onDispose(fn)
    },
    dispose() {
      inner.dispose()
    },
    [Symbol.dispose]() {
      inner.dispose()
    },
  }
}

export function createIsolatedDshKernelScope(
  inner: KernelScope,
  options: { isGlobalShellAllowed: () => boolean; pluginId?: string; onBlocked?: (slot: string) => void },
): KernelScope {
  const isolatedSlots = createIsolatedDshSlotScope(inner.slots, options)

  return {
    get disposed() {
      return inner.disposed
    },
    slots: isolatedSlots,
    registerCommand(definition) {
      return inner.registerCommand(definition)
    },
    registerCommandMiddleware(commandId, middleware, priority) {
      return inner.registerCommandMiddleware(commandId, middleware, priority)
    },
    registerKeybinding(definition: KeybindingDefinition): KernelDisposer {
      const originalWhen = definition.when
      return inner.registerKeybinding({
        ...definition,
        when: (ctx) => ctx.supportsUiPlugins === true && (originalWhen ? originalWhen(ctx) : true),
      })
    },
    registerMenuItem(menuId: MenuId, item: MenuItemDefinition): KernelDisposer {
      return inner.registerMenuItem(menuId, wrapMenuItemForDsh(item))
    },
    registerThemeLayer(layer: ThemeLayerDefinition): KernelDisposer {
      return inner.registerThemeLayer({
        ...layer,
        scope: {
          ...layer.scope,
          harness: 'dsh',
        },
      })
    },
    createChildScope() {
      return createIsolatedDshKernelScope(inner.createChildScope(), options)
    },
    onDispose(fn) {
      return inner.onDispose(fn)
    },
    dispose() {
      inner.dispose()
    },
    [Symbol.dispose]() {
      inner.dispose()
    },
  }
}
