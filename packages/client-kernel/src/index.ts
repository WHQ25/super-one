export * from './types'
export { parseKeyChord } from './keybindings-bus'

import { createSlotRegistry, type SlotRegistry } from '@superone/ui-slots'
import { createCommandsBus } from './commands-bus'
import { createDisposer } from './disposer'
import { createKeybindingsBus } from './keybindings-bus'
import { createLayoutBus } from './layout-bus'
import { createMenusBus } from './menus-bus'
import { createThemeBus } from './theme-bus'
import type {
  ClientKernel,
  CommandDefinition,
  CommandMiddleware,
  KernelDisposer,
  KernelScope,
  KeybindingDefinition,
  MenuId,
  MenuItemDefinition,
  ThemeLayerDefinition,
} from './types'

export interface CreateClientKernelOptions {
  slots?: SlotRegistry
}

export function createClientKernel(options: CreateClientKernelOptions = {}): ClientKernel {
  const slots = options.slots ?? createSlotRegistry()
  const commands = createCommandsBus()
  const keybindings = createKeybindingsBus(commands)
  const menus = createMenusBus(commands)
  const layout = createLayoutBus()
  const theme = createThemeBus()
  const scopes = new Set<KernelScope>()

  function createKernelScope(): KernelScope {
    let disposed = false
    const slotScope = slots.createScope()
    const disposers: Array<() => void> = []
    const children = new Set<KernelScope>()

    const track = (disposer: KernelDisposer): KernelDisposer => {
      if (disposed) {
        disposer()
        return disposer
      }
      disposers.push(disposer)
      return disposer
    }

    const scope: KernelScope = {
      get disposed() {
        return disposed
      },
      slots: slotScope,
      registerCommand(definition: CommandDefinition) {
        return track(commands.registerCommand(definition))
      },
      registerCommandMiddleware(commandId: string | '*', middleware: CommandMiddleware, priority?: number) {
        return track(commands.registerMiddleware(commandId, middleware, priority))
      },
      registerKeybinding(definition: KeybindingDefinition) {
        return track(keybindings.registerKeybinding(definition))
      },
      registerMenuItem(menuId: MenuId, item: MenuItemDefinition) {
        return track(menus.registerMenuItem(menuId, item))
      },
      registerThemeLayer(layer: ThemeLayerDefinition) {
        return track(theme.registerLayer(layer))
      },
      createChildScope() {
        const child = createKernelScope()
        if (disposed) {
          child.dispose()
          return child
        }
        children.add(child)
        child.onDispose(() => {
          children.delete(child)
        })
        return child
      },
      onDispose(fn: () => void) {
        return track(createDisposer(fn))
      },
      dispose() {
        if (disposed) return
        disposed = true
        scopes.delete(scope)
        for (const child of [...children]) {
          try {
            child.dispose()
          } catch (error) {
            console.error('[client-kernel] child scope dispose failed:', error)
          }
        }
        children.clear()
        for (const d of [...disposers].reverse()) {
          try {
            d()
          } catch (error) {
            console.error('[client-kernel] disposer failed:', error)
          }
        }
        disposers.length = 0
        try {
          slotScope.dispose()
        } catch (error) {
          console.error('[client-kernel] slotScope dispose failed:', error)
        }
      },
      [Symbol.dispose]() {
        scope.dispose()
      },
    }

    scopes.add(scope)
    return scope
  }

  return {
    slots,
    commands,
    keybindings,
    menus,
    layout,
    theme,
    createScope: createKernelScope,
    dispose() {
      for (const scope of [...scopes]) scope.dispose()
      scopes.clear()
    },
  }
}
