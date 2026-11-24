import {
  Component,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import type {
  ResolvedChainEntry,
  ResolvedHocEntry,
  ResolvedListEntry,
  SlotKeyOf,
  SlotMap,
  SlotPropsOf,
  SlotRegistry,
  SlotScopeMeta,
  SlotsOfKind,
} from './index'

export type { SlotScopeMeta } from './index'

interface SlotScopeContextValue {
  active: boolean
  scope?: SlotScopeMeta
}

const SlotRegistryContext = createContext<SlotRegistry<any> | null>(null)
const SlotScopeContext = createContext<SlotScopeContextValue>({ active: true })

const EMPTY_LIST: readonly ResolvedListEntry<ComponentType<any>>[] = []
const EMPTY_CHAIN: readonly ResolvedChainEntry<any, ReactNode>[] = []
const EMPTY_HOC: readonly ResolvedHocEntry<ComponentType<any>>[] = []

function subscribeNoop(): () => void {
  return () => {}
}

function getNull(): null {
  return null
}

function getEmptyList(): readonly ResolvedListEntry<ComponentType<any>>[] {
  return EMPTY_LIST
}

function getEmptyChain(): readonly ResolvedChainEntry<any, ReactNode>[] {
  return EMPTY_CHAIN
}

function getEmptyHoc(): readonly ResolvedHocEntry<ComponentType<any>>[] {
  return EMPTY_HOC
}

export function SlotRegistryProvider({
  registry,
  children,
}: {
  registry: SlotRegistry<any> | null
  children?: ReactNode
}) {
  return <SlotRegistryContext.Provider value={registry}>{children}</SlotRegistryContext.Provider>
}

export function SlotScopeProvider({
  active,
  scope,
  children,
}: {
  active: boolean
  scope?: SlotScopeMeta
  children?: ReactNode
}) {
  const value = useMemo<SlotScopeContextValue>(() => ({ active, scope }), [active, scope])
  return <SlotScopeContext.Provider value={value}>{children}</SlotScopeContext.Provider>
}

export function useSlotRegistry(): SlotRegistry<SlotMap> | null {
  return useContext(SlotRegistryContext)
}

export function useSlotScope(): SlotScopeContextValue {
  return useContext(SlotScopeContext)
}

function useSlotSubscription<T>(
  slot: string,
  read: (registry: SlotRegistry<any>) => T,
  inactiveValue: () => T,
): T {
  const registry = useContext(SlotRegistryContext)
  const { active } = useContext(SlotScopeContext)
  const enabled = registry !== null && active

  const subscribe = useCallback(
    (listener: () => void) => (enabled && registry ? registry.subscribeSlot(slot, listener) : subscribeNoop()),
    [enabled, registry, slot],
  )
  const getSnapshot = useCallback(
    () => (enabled && registry ? read(registry) : inactiveValue()),
    [enabled, registry, read, inactiveValue],
  )

  return useSyncExternalStore(subscribe, getSnapshot, inactiveValue)
}

export function useSlotVersion(slot: string): number {
  const registry = useContext(SlotRegistryContext)
  const subscribe = useCallback(
    (listener: () => void) => (registry ? registry.subscribeSlot(slot, listener) : subscribeNoop()),
    [registry, slot],
  )
  const getSnapshot = useCallback(() => (registry ? registry.getSlotVersion(slot) : 0), [registry, slot])
  return useSyncExternalStore(subscribe, getSnapshot, () => 0)
}

export function useSlot<K extends SlotsOfKind<SlotMap, 'single'>>(
  slot: K,
): ComponentType<SlotPropsOf<SlotMap, K>> | null {
  const { scope } = useContext(SlotScopeContext)
  const read = useCallback(
    (registry: SlotRegistry<any>) =>
      registry.getSingle(slot as never, scope) as ComponentType<SlotPropsOf<SlotMap, K>> | null,
    [slot, scope],
  )
  return useSlotSubscription(slot, read, getNull)
}

export function useSlotList<K extends SlotsOfKind<SlotMap, 'list'>>(
  slot: K,
): readonly ResolvedListEntry<ComponentType<SlotPropsOf<SlotMap, K>>>[] {
  const { scope } = useContext(SlotScopeContext)
  const read = useCallback(
    (registry: SlotRegistry<any>) =>
      registry.getList(slot as never) as readonly ResolvedListEntry<ComponentType<SlotPropsOf<SlotMap, K>>>[],
    [slot],
  )
  const entries = useSlotSubscription(slot, read, getEmptyList)
  return useMemo(() => {
    if (entries.length === 0 || !entries.some((entry) => entry.when)) return entries
    const meta = scope ?? {}
    return entries.filter((entry) => !entry.when || entry.when(meta))
  }, [entries, scope])
}

export function useSlotKeyed<K extends SlotsOfKind<SlotMap, 'keyed'>>(
  slot: K,
  key: SlotKeyOf<SlotMap, K>,
): ComponentType<SlotPropsOf<SlotMap, K>> | null {
  const { scope } = useContext(SlotScopeContext)
  const read = useCallback(
    (registry: SlotRegistry<any>) =>
      registry.getKeyed(slot as never, key as never, scope) as ComponentType<SlotPropsOf<SlotMap, K>> | null,
    [slot, key, scope],
  )
  return useSlotSubscription(slot, read, getNull)
}

export function useSlotChain<K extends SlotsOfKind<SlotMap, 'chain'>>(
  slot: K,
  props: SlotPropsOf<SlotMap, K>,
  fallback: (props: SlotPropsOf<SlotMap, K>) => ReactNode,
): ReactNode {
  const { scope } = useContext(SlotScopeContext)
  const read = useCallback(
    (registry: SlotRegistry<any>) =>
      registry.getChain(slot as never) as readonly ResolvedChainEntry<SlotPropsOf<SlotMap, K>, ReactNode>[],
    [slot],
  )
  const entries = useSlotSubscription(slot, read, getEmptyChain)
  if (entries.length === 0) return fallback(props)

  const meta = scope ?? {}
  const matching = entries.filter(
    (entry) => (!entry.when || entry.when(meta)) && (!entry.match || entry.match(props)),
  )
  if (matching.length === 0) return fallback(props)

  const dispatch = (index: number): ReactNode => {
    if (index >= matching.length) return fallback(props)
    const entry = matching[index]
    const next = () => dispatch(index + 1)
    const result = entry.render(props, next)
    return result === null || result === undefined ? next() : result
  }

  return dispatch(0)
}

function matchesHocFilter(
  filterKey: string | ((key?: string) => boolean) | undefined,
  key: string | undefined,
): boolean {
  if (filterKey === undefined) return true
  if (typeof filterKey === 'string') return filterKey === key
  return filterKey(key)
}

export function useSlotHoc<K extends SlotsOfKind<SlotMap, 'hoc'>>(
  slot: K,
  BaseComponent: ComponentType<SlotPropsOf<SlotMap, K>>,
  filterKey?: string,
): ComponentType<SlotPropsOf<SlotMap, K>> {
  const { scope } = useContext(SlotScopeContext)
  const read = useCallback(
    (registry: SlotRegistry<any>) =>
      registry.getHoc(slot as never) as readonly ResolvedHocEntry<ComponentType<SlotPropsOf<SlotMap, K>>>[],
    [slot],
  )
  const entries = useSlotSubscription(slot, read, getEmptyHoc)

  return useMemo(() => {
    if (entries.length === 0) return BaseComponent
    const meta = scope ?? {}
    const matching = entries.filter(
      (entry) => (!entry.when || entry.when(meta)) && matchesHocFilter(entry.filterKey, filterKey),
    )
    if (matching.length === 0) return BaseComponent
    return matching.reduceRight(
      (Acc, entry) => entry.wrap(Acc),
      BaseComponent,
    )
  }, [entries, BaseComponent, filterKey, scope])
}

export function SlotSingle<K extends SlotsOfKind<SlotMap, 'single'>>({
  name,
  props,
  fallback: Fallback,
}: {
  name: K
  props: SlotPropsOf<SlotMap, K>
  fallback?: ComponentType<SlotPropsOf<SlotMap, K>>
}) {
  const Resolved = useSlot(name) ?? Fallback
  if (!Resolved) return null
  return <Resolved {...(props as any)} />
}

export function SlotList<K extends SlotsOfKind<SlotMap, 'list'>>({
  name,
  props,
}: {
  name: K
  props: SlotPropsOf<SlotMap, K>
}) {
  const items = useSlotList(name)
  if (items.length === 0) return null
  return (
    <>
      {items.map((item) => {
        const Item = item.component
        return <Item key={item.id} {...(props as any)} />
      })}
    </>
  )
}

export function SlotHoc<K extends SlotsOfKind<SlotMap, 'hoc'>>({
  name,
  component,
  filterKey,
  props,
  children,
}: {
  name: K
  component: ComponentType<SlotPropsOf<SlotMap, K>>
  filterKey?: string
  props?: Omit<SlotPropsOf<SlotMap, K>, 'children'>
  children?: ReactNode
}) {
  const Wrapped = useSlotHoc(name, component, filterKey)
  const mergedProps = children !== undefined ? { ...(props as any), children } : (props as any)
  return <Wrapped {...mergedProps} />
}

export function SlotChain<K extends SlotsOfKind<SlotMap, 'chain'>>({
  name,
  props,
  fallback,
}: {
  name: K
  props: SlotPropsOf<SlotMap, K>
  fallback: (props: SlotPropsOf<SlotMap, K>) => ReactNode
}) {
  return <>{useSlotChain(name, props, fallback)}</>
}

interface PluginSlotErrorBoundaryProps {
  resetKey?: string
  fallback: ReactNode | (() => ReactNode)
  onError?: (error: Error, info: ErrorInfo) => void
  children: ReactNode
}

interface PluginSlotErrorBoundaryState {
  hasError: boolean
  capturedResetKey?: string
}

export class PluginSlotErrorBoundary extends Component<
  PluginSlotErrorBoundaryProps,
  PluginSlotErrorBoundaryState
> {
  state: PluginSlotErrorBoundaryState = { hasError: false, capturedResetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<PluginSlotErrorBoundaryState> {
    return { hasError: true }
  }

  static getDerivedStateFromProps(
    props: PluginSlotErrorBoundaryProps,
    state: PluginSlotErrorBoundaryState,
  ): Partial<PluginSlotErrorBoundaryState> | null {
    if (props.resetKey !== state.capturedResetKey) {
      return { hasError: false, capturedResetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return typeof this.props.fallback === 'function' ? this.props.fallback() : this.props.fallback
    }
    return this.props.children
  }
}
