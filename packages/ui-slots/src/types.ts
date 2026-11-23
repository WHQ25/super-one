export type SlotKind = 'single' | 'list' | 'keyed' | 'chain' | 'hoc'

export interface SlotMap {}

export interface SlotDefinition<
  Kind extends SlotKind = SlotKind,
  Props = Record<string, unknown>,
  Key extends string = string,
> {
  kind: Kind
  props: Props
  key?: Key
}

export type SlotComponent<P = Record<string, unknown>> =
  | ((props: P) => any)
  | (new (props: P) => any)

export type SlotsOfKind<M, Kind extends SlotKind> = keyof M extends never
  ? string
  : { [K in keyof M]: M[K] extends { kind: Kind } ? K : never }[keyof M] & string

export type SlotPropsOf<M, K extends string> = K extends keyof M
  ? M[K] extends { props: infer P }
    ? P
    : Record<string, unknown>
  : Record<string, unknown>

export type SlotKeyOf<M, K extends string> = K extends keyof M
  ? M[K] extends { key: infer Key extends string }
    ? Key
    : string
  : string

export interface SlotDisposer {
  (): void
  dispose(): void
  [Symbol.dispose](): void
}

export interface SingleSlotEntry<P = Record<string, unknown>, C = SlotComponent<P>> {
  id?: string
  priority?: number
  component: C
  _brand?: (props: P) => void
}

export interface ListSlotEntry<P = Record<string, unknown>, C = SlotComponent<P>> {
  id?: string
  order?: number
  component: C
  _brand?: (props: P) => void
}

export interface KeyedSlotEntry<P = Record<string, unknown>, C = SlotComponent<P>> {
  id?: string
  priority?: number
  component: C
  _brand?: (props: P) => void
}

export interface ChainSlotEntry<P = Record<string, unknown>, R = any> {
  id?: string
  priority?: number
  match?: (props: P) => boolean
  render: (props: P, next: () => R) => R | null | undefined
}

export interface HocSlotEntry<P = Record<string, unknown>, C = SlotComponent<P>> {
  id?: string
  priority?: number
  filterKey?: string | ((key?: string) => boolean)
  wrap: (Component: C) => C
  _brand?: (props: P) => void
}

export interface ResolvedListEntry<C = unknown> {
  id: string
  order: number
  component: C
}

export interface ResolvedChainEntry<P = Record<string, unknown>, R = unknown> {
  id: string
  priority: number
  match?: (props: P) => boolean
  render: (props: P, next: () => R) => R | null | undefined
}

export interface ResolvedHocEntry<C = unknown> {
  id: string
  priority: number
  filterKey?: string | ((key?: string) => boolean)
  wrap: (Component: C) => C
}

export interface SlotScopeHandle {
  registerSingle<K extends SlotsOfKind<SlotMap, 'single'>>(
    slot: K,
    entry: SingleSlotEntry<SlotPropsOf<SlotMap, K>>,
  ): SlotDisposer
  registerList<K extends SlotsOfKind<SlotMap, 'list'>>(
    slot: K,
    entry: ListSlotEntry<SlotPropsOf<SlotMap, K>>,
  ): SlotDisposer
  registerKeyed<K extends SlotsOfKind<SlotMap, 'keyed'>>(
    slot: K,
    key: SlotKeyOf<SlotMap, K>,
    entry: KeyedSlotEntry<SlotPropsOf<SlotMap, K>>,
  ): SlotDisposer
  registerChain<K extends SlotsOfKind<SlotMap, 'chain'>>(
    slot: K,
    entry: ChainSlotEntry<SlotPropsOf<SlotMap, K>>,
  ): SlotDisposer
  registerHoc<K extends SlotsOfKind<SlotMap, 'hoc'>>(
    slot: K,
    entry: HocSlotEntry<SlotPropsOf<SlotMap, K>>,
  ): SlotDisposer
  createScope(): SlotScopeHandle
  onDispose(fn: () => void): SlotDisposer
  dispose(): void
  [Symbol.dispose](): void
}

export interface SlotRegistry<M = SlotMap> {
  registerSingle<K extends SlotsOfKind<M, 'single'>>(
    slot: K,
    entry: SingleSlotEntry<SlotPropsOf<M, K>>,
  ): SlotDisposer
  registerList<K extends SlotsOfKind<M, 'list'>>(
    slot: K,
    entry: ListSlotEntry<SlotPropsOf<M, K>>,
  ): SlotDisposer
  registerKeyed<K extends SlotsOfKind<M, 'keyed'>>(
    slot: K,
    key: SlotKeyOf<M, K>,
    entry: KeyedSlotEntry<SlotPropsOf<M, K>>,
  ): SlotDisposer
  registerChain<K extends SlotsOfKind<M, 'chain'>>(
    slot: K,
    entry: ChainSlotEntry<SlotPropsOf<M, K>>,
  ): SlotDisposer
  registerHoc<K extends SlotsOfKind<M, 'hoc'>>(
    slot: K,
    entry: HocSlotEntry<SlotPropsOf<M, K>>,
  ): SlotDisposer
  getSingle<K extends SlotsOfKind<M, 'single'>>(slot: K): unknown | null
  getList<K extends SlotsOfKind<M, 'list'>>(slot: K): readonly ResolvedListEntry[]
  getKeyed<K extends SlotsOfKind<M, 'keyed'>>(slot: K, key: SlotKeyOf<M, K>): unknown | null
  hasKeyed<K extends SlotsOfKind<M, 'keyed'>>(slot: K, key: string): boolean
  getKeyedKeys<K extends SlotsOfKind<M, 'keyed'>>(slot: K): readonly string[]
  getChain<K extends SlotsOfKind<M, 'chain'>>(slot: K): readonly ResolvedChainEntry<SlotPropsOf<M, K>>[]
  getHoc<K extends SlotsOfKind<M, 'hoc'>>(slot: K): readonly ResolvedHocEntry[]
  createScope(): SlotScopeHandle
  subscribeSlot(slot: string, listener: () => void): () => void
  subscribe(listener: () => void): () => void
  getSlotVersion(slot: string): number
}
