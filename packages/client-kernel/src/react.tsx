import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { SlotRegistryProvider } from '@superone/ui-slots/react'
import type {
  ClientKernel,
  MenuContext,
  MenuId,
  ResolvedMenuItem,
  ResolvedThemeOverrides,
  ThemeScope,
} from './types'

const ClientKernelContext = createContext<ClientKernel | null>(null)

export function ClientKernelProvider({
  kernel,
  children,
}: {
  kernel: ClientKernel
  children: ReactNode
}): React.JSX.Element {
  return (
    <ClientKernelContext.Provider value={kernel}>
      <SlotRegistryProvider registry={kernel.slots}>{children}</SlotRegistryProvider>
    </ClientKernelContext.Provider>
  )
}

export function useClientKernelOptional(): ClientKernel | null {
  return useContext(ClientKernelContext)
}

export function useClientKernel(): ClientKernel {
  const kernel = useContext(ClientKernelContext)
  if (!kernel) {
    throw new Error('useClientKernel must be used within a ClientKernelProvider')
  }
  return kernel
}

const EMPTY_MENU_ITEMS: readonly ResolvedMenuItem[] = []

export function useMenuItems(menuId: MenuId, ctx: MenuContext): readonly ResolvedMenuItem[] {
  const kernel = useClientKernelOptional()
  const version = useSyncExternalStore(
    (onStoreChange) => (kernel ? kernel.menus.subscribeMenu(menuId, onStoreChange) : () => {}),
    () => (kernel ? kernel.menus.getVersion(menuId) : -1),
    () => -1,
  )
  return useMemo(() => {
    void version
    return kernel ? kernel.menus.getMenuItems(menuId, ctx) : EMPTY_MENU_ITEMS
  }, [kernel, menuId, ctx, version])
}

export function useThemeOverrides(scope?: ThemeScope): ResolvedThemeOverrides | null {
  const kernel = useClientKernelOptional()
  const version = useSyncExternalStore(
    (onStoreChange) => (kernel ? kernel.theme.subscribe(onStoreChange) : () => {}),
    () => (kernel ? kernel.theme.getVersion(scope) : -1),
    () => -1,
  )
  return useMemo(() => {
    void version
    return kernel ? kernel.theme.getOverrides(scope) : null
  }, [kernel, scope?.projectPath, scope?.sessionId, scope?.harness, version])
}
