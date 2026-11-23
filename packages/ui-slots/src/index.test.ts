/** @vitest-environment jsdom */

import { createElement, type ComponentType, type ReactNode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSlotRegistry } from './index'
import {
  SlotHoc,
  SlotList,
  SlotRegistryProvider,
  SlotScopeProvider,
  SlotSingle,
  useSlot,
  useSlotChain,
  useSlotHoc,
  useSlotKeyed,
  useSlotList,
} from './react'

afterEach(() => {
  cleanup()
})

describe('SlotRegistry & React slot bindings', () => {
  it('resolves single slot by highest priority and falls back on dispose', () => {
    const registry = createSlotRegistry()
    const Low = () => createElement('span', null, 'low')
    const High = () => createElement('span', null, 'high')

    const d1 = registry.registerSingle('header.title' as never, { priority: 1, component: Low })
    const d2 = registry.registerSingle('header.title' as never, { priority: 10, component: High })

    render(
      createElement(
        SlotRegistryProvider,
        { registry },
        createElement(SlotSingle, { name: 'header.title' as never, props: {} as never }),
      ),
    )

    expect(screen.getByText('high')).toBeTruthy()

    act(() => {
      d2.dispose()
    })
    expect(screen.getByText('low')).toBeTruthy()

    act(() => {
      d1()
    })
    expect(screen.queryByText('low')).toBeNull()
  })

  it('orders list slot entries by order ascending and updates reactively', () => {
    const registry = createSlotRegistry()
    const A = () => createElement('span', { 'data-testid': 'item' }, 'A')
    const B = () => createElement('span', { 'data-testid': 'item' }, 'B')
    const C = () => createElement('span', { 'data-testid': 'item' }, 'C')

    registry.registerList('session.header.actions' as never, { id: 'b', order: 20, component: B })
    const dA = registry.registerList('session.header.actions' as never, { id: 'a', order: 5, component: A })
    registry.registerList('session.header.actions' as never, { id: 'c', order: 20, component: C })

    render(
      createElement(
        SlotRegistryProvider,
        { registry },
        createElement(SlotList, { name: 'session.header.actions' as never, props: {} as never }),
      ),
    )

    expect(screen.getAllByTestId('item').map((el) => el.textContent)).toEqual(['A', 'B', 'C'])

    act(() => {
      dA.dispose()
    })
    expect(screen.getAllByTestId('item').map((el) => el.textContent)).toEqual(['B', 'C'])
  })

  it('resolves keyed slot entries and tracks live keys', () => {
    const registry = createSlotRegistry()
    const PanelOne = ({ label }: { label: string }) => createElement('div', null, `panel-1:${label}`)

    const d = registry.registerKeyed('activity.panel' as never, 'panel-1' as never, { component: PanelOne })
    expect(registry.hasKeyed('activity.panel' as never, 'panel-1')).toBe(true)
    expect(registry.getKeyedKeys('activity.panel' as never)).toEqual(['panel-1'])

    function Probe({ panelKey }: { panelKey: string }) {
      const Comp = useSlotKeyed('activity.panel' as never, panelKey as never) as ComponentType<{ label: string }> | null
      return Comp ? createElement(Comp, { label: 'ok' }) : createElement('div', null, 'missing')
    }

    const { rerender } = render(
      createElement(
        SlotRegistryProvider,
        { registry },
        createElement(Probe, { panelKey: 'panel-1' }),
      ),
    )
    expect(screen.getByText('panel-1:ok')).toBeTruthy()

    rerender(
      createElement(
        SlotRegistryProvider,
        { registry },
        createElement(Probe, { panelKey: 'unknown' }),
      ),
    )
    expect(screen.getByText('missing')).toBeTruthy()

    act(() => {
      d.dispose()
    })
    expect(registry.hasKeyed('activity.panel' as never, 'panel-1')).toBe(false)
    expect(registry.getKeyedKeys('activity.panel' as never)).toEqual([])
  })

  it('evaluates chain slot in priority order and delegates null/next to fallback', () => {
    const registry = createSlotRegistry()
    registry.registerChain('chat.toolBlock' as never, {
      id: 'low-priority',
      priority: 1,
      render: (props: { toolName: string }) =>
        props.toolName === 'Alpha' ? createElement('div', null, 'alpha-low') : null,
    })
    registry.registerChain('chat.toolBlock' as never, {
      id: 'high-priority',
      priority: 10,
      match: (props: { toolName: string }) => props.toolName === 'Alpha',
      render: () => createElement('div', null, 'alpha-high'),
    })
    registry.registerChain('chat.toolBlock' as never, {
      id: 'wrapper',
      priority: 20,
      match: (props: { toolName: string }) => props.toolName === 'Beta',
      render: (_props, next) => createElement('div', { 'data-testid': 'wrapped' }, next()),
    })

    function Probe({ toolName }: { toolName: string }) {
      return useSlotChain(
        'chat.toolBlock' as never,
        { toolName } as never,
        (p: { toolName: string }) => createElement('span', null, `default:${p.toolName}`),
      )
    }

    const { rerender } = render(
      createElement(SlotRegistryProvider, { registry }, createElement(Probe, { toolName: 'Alpha' })),
    )
    expect(screen.getByText('alpha-high')).toBeTruthy()

    rerender(createElement(SlotRegistryProvider, { registry }, createElement(Probe, { toolName: 'Beta' })))
    expect(screen.getByTestId('wrapped').textContent).toBe('default:Beta')

    rerender(createElement(SlotRegistryProvider, { registry }, createElement(Probe, { toolName: 'Gamma' })))
    expect(screen.getByText('default:Gamma')).toBeTruthy()
  })

  it('composes hoc wrappers with optional filterKey and priority order', () => {
    const registry = createSlotRegistry()
    const Base = ({ children }: { children?: ReactNode }) => createElement('div', { 'data-testid': 'base' }, children)

    registry.registerHoc('session.providers' as never, {
      priority: 10,
      wrap: (Next) =>
        ({ children }: { children?: ReactNode }) => createElement('div', { 'data-testid': 'outer' }, createElement(Next, null, children)),
    })
    registry.registerHoc('session.providers' as never, {
      priority: 1,
      filterKey: 'only-dsh',
      wrap: (Next) =>
        ({ children }: { children?: ReactNode }) => createElement('div', { 'data-testid': 'inner' }, createElement(Next, null, children)),
    })

    const { rerender } = render(
      createElement(
        SlotRegistryProvider,
        { registry },
        createElement(SlotHoc, {
          name: 'session.providers' as never,
          component: Base as never,
          filterKey: 'only-dsh',
          props: { children: 'hello' } as never,
        }),
      ),
    )

    const outer = screen.getByTestId('outer')
    const inner = screen.getByTestId('inner')
    expect(outer.contains(inner)).toBe(true)
    expect(inner.textContent).toBe('hello')

    rerender(
      createElement(
        SlotRegistryProvider,
        { registry },
        createElement(SlotHoc, {
          name: 'session.providers' as never,
          component: Base as never,
          filterKey: 'other',
          props: { children: 'hello' } as never,
        }),
      ),
    )
    expect(screen.queryByTestId('inner')).toBeNull()
    expect(screen.getByTestId('outer').textContent).toBe('hello')
  })

  it('cascades disposer cleanup across nested scopes in reverse order', () => {
    const registry = createSlotRegistry()
    const order: string[] = []
    const rootScope = registry.createScope()
    rootScope.onDispose(() => order.push('root'))
    const childScope = rootScope.createScope()

    const Comp = () => createElement('span', null, 'scoped')
    rootScope.registerSingle('s1' as never, { component: Comp })
    childScope.registerList('s2' as never, { component: Comp })
    childScope.onDispose(() => order.push('child'))

    expect(registry.getSingle('s1' as never)).toBe(Comp)
    expect(registry.getList('s2' as never)).toHaveLength(1)

    const listener = vi.fn()
    registry.subscribe(listener)

    rootScope.dispose()
    rootScope.dispose()

    expect(registry.getSingle('s1' as never)).toBeNull()
    expect(registry.getList('s2' as never)).toHaveLength(0)
    expect(order).toEqual(['child', 'root'])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('bypasses all slot entries when SlotScopeProvider active is false', () => {
    const registry = createSlotRegistry()
    const PluginComp = () => createElement('span', null, 'plugin-active')
    registry.registerSingle('s.single' as never, { component: PluginComp })
    registry.registerList('s.list' as never, { component: PluginComp })
    registry.registerKeyed('s.keyed' as never, 'k1' as never, { component: PluginComp })
    registry.registerChain('s.chain' as never, { render: () => createElement('span', null, 'plugin-chain') })
    registry.registerHoc('s.hoc' as never, {
      wrap: () => () => createElement('span', null, 'plugin-hoc'),
    })

    const Fallback = () => createElement('span', null, 'stock-fallback')

    function Probe() {
      const single = useSlot('s.single' as never)
      const list = useSlotList('s.list' as never)
      const keyed = useSlotKeyed('s.keyed' as never, 'k1' as never)
      const chain = useSlotChain('s.chain' as never, {} as never, () => createElement('span', null, 'stock-chain'))
      const HocComp = useSlotHoc('s.hoc' as never, Fallback as never)
      return createElement(
        'div',
        null,
        createElement('span', { 'data-testid': 'single' }, single ? 'hit' : 'miss'),
        createElement('span', { 'data-testid': 'list' }, String(list.length)),
        createElement('span', { 'data-testid': 'keyed' }, keyed ? 'hit' : 'miss'),
        createElement('div', { 'data-testid': 'chain' }, chain),
        createElement(HocComp as ComponentType, null),
      )
    }

    const { rerender } = render(
      createElement(
        SlotRegistryProvider,
        { registry },
        createElement(SlotScopeProvider, { active: false }, createElement(Probe)),
      ),
    )

    expect(screen.getByTestId('single').textContent).toBe('miss')
    expect(screen.getByTestId('list').textContent).toBe('0')
    expect(screen.getByTestId('keyed').textContent).toBe('miss')
    expect(screen.getByTestId('chain').textContent).toBe('stock-chain')
    expect(screen.getByText('stock-fallback')).toBeTruthy()

    rerender(
      createElement(
        SlotRegistryProvider,
        { registry },
        createElement(SlotScopeProvider, { active: true }, createElement(Probe)),
      ),
    )

    expect(screen.getByTestId('single').textContent).toBe('hit')
    expect(screen.getByTestId('list').textContent).toBe('1')
    expect(screen.getByTestId('keyed').textContent).toBe('hit')
    expect(screen.getByTestId('chain').textContent).toBe('plugin-chain')
    expect(screen.getByText('plugin-hoc')).toBeTruthy()
  })

  it('degrades safely to fallbacks when rendered outside SlotRegistryProvider', () => {
    const Fallback = () => createElement('span', null, 'standalone-hoc')

    function StandaloneProbe() {
      const single = useSlot('s.single' as never)
      const list = useSlotList('s.list' as never)
      const keyed = useSlotKeyed('s.keyed' as never, 'k1' as never)
      const chain = useSlotChain('s.chain' as never, {} as never, () => createElement('span', null, 'standalone-chain'))
      const HocComp = useSlotHoc('s.hoc' as never, Fallback as never)
      return createElement(
        'div',
        null,
        createElement('span', { 'data-testid': 'single' }, single ? 'hit' : 'miss'),
        createElement('span', { 'data-testid': 'list' }, String(list.length)),
        createElement('span', { 'data-testid': 'keyed' }, keyed ? 'hit' : 'miss'),
        createElement('div', { 'data-testid': 'chain' }, chain),
        createElement(HocComp as ComponentType, null),
      )
    }

    render(createElement(StandaloneProbe))

    expect(screen.getByTestId('single').textContent).toBe('miss')
    expect(screen.getByTestId('list').textContent).toBe('0')
    expect(screen.getByTestId('keyed').textContent).toBe('miss')
    expect(screen.getByTestId('chain').textContent).toBe('standalone-chain')
    expect(screen.getByText('standalone-hoc')).toBeTruthy()
  })
})
