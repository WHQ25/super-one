/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createClientKernel, type KeybindingContext, type MenuContext } from './index'
import { ClientKernelProvider, useClientKernel, useMenuItems, useThemeOverrides } from './react'

function baseKeyContext(overrides: Partial<KeybindingContext> = {}): KeybindingContext {
  return {
    view: 'main',
    supportsUiPlugins: true,
    inTerminal: false,
    inInput: false,
    inActivity: false,
    focusArea: 'chat',
    ...overrides,
  }
}

describe('packages/client-kernel', () => {
  it('supports command registration, priority override, middleware, and scope disposal', async () => {
    const kernel = createClientKernel()
    const trace: string[] = []
    const scope = kernel.createScope()

    scope.registerCommand({
      id: 'demo.run',
      handler: (arg: string) => {
        trace.push(`base:${arg}`)
        return `base-res:${arg}`
      },
    })
    const child = scope.createChildScope()
    child.registerCommand({
      id: 'demo.run',
      priority: 10,
      handler: (arg: string) => {
        trace.push(`override:${arg}`)
        return `override-res:${arg}`
      },
    })
    child.registerCommandMiddleware('demo.run', async (inv, next) => {
      trace.push(`mw-before:${inv.id}`)
      const result = await next()
      trace.push('mw-after')
      return result
    })

    await expect(kernel.commands.executeCommand('demo.run', 'x')).resolves.toBe('override-res:x')
    expect(trace).toEqual(['mw-before:demo.run', 'override:x', 'mw-after'])

    child.dispose()
    await expect(kernel.commands.executeCommand('demo.run', 'y')).resolves.toBe('base-res:y')

    scope.dispose()
    expect(kernel.commands.hasCommand('demo.run')).toBe(false)
    await expect(kernel.commands.executeCommand('demo.run')).rejects.toThrow(/not registered/)
  })

  it('evaluates keybindings with when predicates, .xterm exclusion, and forwarded shortcuts', () => {
    const kernel = createClientKernel()
    const calls: string[] = []
    const scope = kernel.createScope()

    scope.registerCommand({
      id: 'demo.toggle',
      handler: (ctx: KeybindingContext) => {
        calls.push(`${ctx.sessionId ?? 'none'}:${ctx.focusArea}`)
      },
    })
    scope.registerKeybinding({
      key: 'ctrl+shift+k',
      command: 'demo.toggle',
      when: (ctx) => ctx.supportsUiPlugins && !ctx.inInput,
    })

    const eventBlocked = new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true, cancelable: true })
    expect(kernel.keybindings.handleKeyEvent(eventBlocked, () => baseKeyContext({ sessionId: 's1', supportsUiPlugins: false }))).toBe(false)
    expect(eventBlocked.defaultPrevented).toBe(false)

    const eventXterm = new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true, cancelable: true })
    expect(kernel.keybindings.handleKeyEvent(eventXterm, () => baseKeyContext({ sessionId: 's1', inTerminal: true, focusArea: 'xterm' }))).toBe(false)

    const eventAllowed = new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true, cancelable: true })
    expect(kernel.keybindings.handleKeyEvent(eventAllowed, () => baseKeyContext({ sessionId: 's1' }))).toBe(true)
    expect(eventAllowed.defaultPrevented).toBe(true)

    expect(kernel.keybindings.dispatchShortcut('demo.toggle', baseKeyContext({ sessionId: 's2', focusArea: 'activity' }))).toBe(true)
    expect(calls).toEqual(['s1:chat', 's2:activity'])

    scope.dispose()
    expect(kernel.keybindings.listKeybindings()).toHaveLength(0)
  })

  it('filters and sorts menu contributions across session, composer, and launcher menus', () => {
    const kernel = createClientKernel()
    const selected: string[] = []
    const scope = kernel.createScope()

    scope.registerMenuItem('session.contextMenu', {
      id: 'b',
      group: '20-plugin',
      order: 2,
      label: 'Second',
      when: (ctx) => ctx.supportsUiPlugins === true,
      onSelect: (ctx) => {
        selected.push(`b:${ctx.sessionId ?? ''}`)
      },
    })
    scope.registerMenuItem('session.contextMenu', {
      id: 'a',
      group: '10-core',
      order: 1,
      label: 'First',
      onSelect: (ctx) => {
        selected.push(`a:${ctx.sessionId ?? ''}`)
      },
    })

    const dshCtx: MenuContext = { menuId: 'session.contextMenu', sessionId: 's-dsh', supportsUiPlugins: true }
    const claudeCtx: MenuContext = { menuId: 'session.contextMenu', sessionId: 's-claude', supportsUiPlugins: false }

    const dshItems = kernel.menus.getMenuItems('session.contextMenu', dshCtx)
    expect(dshItems.map((i) => i.id)).toEqual(['a', 'b'])
    dshItems[1].onSelect()
    expect(selected).toEqual(['b:s-dsh'])

    const claudeItems = kernel.menus.getMenuItems('session.contextMenu', claudeCtx)
    expect(claudeItems.map((i) => i.id)).toEqual(['a'])

    scope.dispose()
    expect(kernel.menus.getMenuItems('session.contextMenu', dshCtx)).toEqual([])
  })

  it('delegates layout operations to adapter and returns explicit unsupported when missing', async () => {
    const kernel = createClientKernel()
    const unsupported = await kernel.layout.openPanel({ panelKey: 'sample:inspector', title: 'Sample' })
    expect(unsupported).toEqual({
      ok: false,
      unsupported: true,
      code: 'unsupported',
      message: expect.stringContaining('openPanel'),
    })

    const openPanel = vi.fn().mockResolvedValue({ ok: true, data: { tab: 'plugin:sample:inspector' } })
    const unbind = kernel.layout.setAdapter({
      openPanel,
      getSnapshot: () => ({ window: { layout: 'single' } }),
    })

    await expect(kernel.layout.openPanel({ panelKey: 'sample:inspector', title: 'Sample' })).resolves.toEqual({
      ok: true,
      data: { tab: 'plugin:sample:inspector' },
    })
    expect(openPanel).toHaveBeenCalledTimes(1)
    expect(kernel.layout.getSnapshot()).toEqual({ window: { layout: 'single' } })

    unbind()
    await expect(kernel.layout.openPanel({ panelKey: 'sample:inspector', title: 'Sample' })).resolves.toMatchObject({
      ok: false,
      unsupported: true,
      code: 'unsupported',
    })
  })

  it('merges scoped theme layers without leaking across scopes and cleans up on dispose', () => {
    const kernel = createClientKernel()
    const scope = kernel.createScope()

    scope.registerThemeLayer({
      brandHue: 290,
      lightTokens: { '--primary': { h: 290 } },
      cssVars: { '--global-var': '1' },
    })
    scope.registerThemeLayer({
      scope: { projectPath: '/repo', sessionId: 's-dsh' },
      brandHue: 210,
      lightTokens: { '--primary': { c: 0.18 }, '--card': { l: 0.96 } },
      cssVars: { '--pane-accent': 'oklch(0.6 0.2 210)' },
    })

    const dshTheme = kernel.theme.getOverrides({ projectPath: '/repo', sessionId: 's-dsh', harness: 'dsh' })
    expect(dshTheme.brandHue).toBe(210)
    expect(dshTheme.lightTokens['--primary']).toEqual({ h: 290, c: 0.18 })
    expect(dshTheme.cssVars['--pane-accent']).toBe('oklch(0.6 0.2 210)')

    const claudeTheme = kernel.theme.getOverrides({ projectPath: '/repo', sessionId: 's-claude', harness: 'claude' })
    expect(claudeTheme.brandHue).toBe(290)
    expect(claudeTheme.cssVars['--pane-accent']).toBeUndefined()

    scope.dispose()
    expect(kernel.theme.getOverrides({ projectPath: '/repo', sessionId: 's-dsh' })).toEqual({
      lightTokens: {},
      darkTokens: {},
      cssVars: {},
    })
  })

  it('provides ClientKernel and SlotRegistry through React hooks', () => {
    const kernel = createClientKernel()
    const scope = kernel.createScope()
    scope.registerMenuItem('activity.launcher', { id: 'demo', label: 'Demo Item' })
    scope.registerThemeLayer({ scope: { sessionId: 's1' }, cssVars: { '--x': '42' } })

    function Probe() {
      const k = useClientKernel()
      const items = useMenuItems('activity.launcher', { menuId: 'activity.launcher' })
      const theme = useThemeOverrides({ sessionId: 's1' })
      return (
        <div>
          <span data-testid="same">{String(k === kernel)}</span>
          <span data-testid="items">{items.map((i) => i.label).join(',')}</span>
          <span data-testid="var">{theme?.cssVars['--x'] ?? ''}</span>
        </div>
      )
    }

    render(
      <ClientKernelProvider kernel={kernel}>
        <Probe />
      </ClientKernelProvider>,
    )

    expect(screen.getByTestId('same').textContent).toBe('true')
    expect(screen.getByTestId('items').textContent).toBe('Demo Item')
    expect(screen.getByTestId('var').textContent).toBe('42')

    scope.dispose()
  })
})
