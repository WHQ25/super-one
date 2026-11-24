import type {
  KernelDisposer,
  KernelScope,
  KeybindingDefinition,
  MenuId,
  MenuItemDefinition,
  ThemeLayerDefinition,
} from '@superone/client-kernel'
import type { SlotDisposer, SlotScopeHandle, SlotScopeMeta } from '@superone/ui-slots'

const RESERVED_ACTIVITY_PANEL_KEYS = new Set(['review', 'trajectory'])

const NOOP_SLOT_DISPOSER: SlotDisposer = Object.assign(() => {}, {
  dispose: () => {},
  [Symbol.dispose]: () => {},
})

function wrapSlotWhen(originalWhen?: (scope: SlotScopeMeta) => boolean): (scope: SlotScopeMeta) => boolean {
  return (scope) => scope.supportsUiPlugins !== false && (originalWhen ? originalWhen(scope) : true)
}

function wrapMenuItemForDsh(item: MenuItemDefinition): MenuItemDefinition {
  const originalWhen = item.when
  return {
    ...item,
    when: (ctx) => ctx.supportsUiPlugins === true && (originalWhen ? originalWhen(ctx) : true),
    ...(item.submenu ? { submenu: item.submenu.map(wrapMenuItemForDsh) } : {}),
  }
}

export function createIsolatedDshSlotScope(inner: SlotScopeHandle): SlotScopeHandle {
  return {
    registerSingle(slot, entry) {
      return inner.registerSingle(slot, { ...entry, when: wrapSlotWhen(entry.when) })
    },
    registerList(slot, entry) {
      return inner.registerList(slot, { ...entry, when: wrapSlotWhen(entry.when) })
    },
    registerKeyed(slot, key, entry) {
      if (String(slot) === 'activity.panel' && RESERVED_ACTIVITY_PANEL_KEYS.has(String(key))) {
        return NOOP_SLOT_DISPOSER
      }
      return inner.registerKeyed(slot, key, { ...entry, when: wrapSlotWhen(entry.when) })
    },
    registerChain(slot, entry) {
      return inner.registerChain(slot, { ...entry, when: wrapSlotWhen(entry.when) })
    },
    registerHoc(slot, entry) {
      return inner.registerHoc(slot, { ...entry, when: wrapSlotWhen(entry.when) })
    },
    createScope() {
      return createIsolatedDshSlotScope(inner.createScope())
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
  options?: { isSessionActive?: () => boolean },
): KernelScope {
  const isolatedSlots = createIsolatedDshSlotScope(inner.slots)
  const isSessionActive = options?.isSessionActive ?? (() => true)

  return {
    get disposed() {
      return inner.disposed
    },
    slots: isolatedSlots,
    registerCommand(definition) {
      return inner.registerCommand(definition)
    },
    registerCommandMiddleware(commandId, middleware, priority) {
      return inner.registerCommandMiddleware(
        commandId,
        (ctx, next) => (isSessionActive() ? middleware(ctx, next) : next()),
        priority,
      )
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
