/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { createClientKernel, type KeybindingContext, type MenuContext } from '@superone/client-kernel'
import { createIsolatedDshKernelScope } from './dsh-isolation'

describe('dsh L2 predicate and shell isolation', () => {
  it('auto-predicates L2 keybindings, menus, command middleware, and slots without toggle', async () => {
    const kernel = createClientKernel()
    const fired: string[] = []
    let sessionActive = false

    const scope = createIsolatedDshKernelScope(kernel.createScope(), {
      isSessionActive: () => sessionActive,
    })

    scope.registerCommand({
      id: 'dsh.sample',
      handler: (ctx: KeybindingContext) => {
        fired.push(ctx.provider ?? 'none')
      },
    })
    scope.registerKeybinding({
      key: 'ctrl+shift+y',
      command: 'dsh.sample',
    })
    scope.registerMenuItem('session.contextMenu', {
      id: 'dsh-action',
      label: 'DSH Action',
    })

    const claudeEvent = new KeyboardEvent('keydown', { key: 'Y', code: 'KeyY', ctrlKey: true, shiftKey: true, cancelable: true })
    expect(
      kernel.keybindings.handleKeyEvent(claudeEvent, () => ({
        view: 'main',
        provider: 'claude',
        supportsUiPlugins: false,
        inTerminal: false,
        inInput: false,
        inActivity: false,
        focusArea: 'chat',
      })),
    ).toBe(false)

    const dshEvent = new KeyboardEvent('keydown', { key: 'Y', code: 'KeyY', ctrlKey: true, shiftKey: true, cancelable: true })
    expect(
      kernel.keybindings.handleKeyEvent(dshEvent, () => ({
        view: 'main',
        provider: 'dsh',
        supportsUiPlugins: true,
        inTerminal: false,
        inInput: false,
        inActivity: false,
        focusArea: 'chat',
      })),
    ).toBe(true)
    expect(fired).toEqual(['dsh'])

    const claudeMenuCtx: MenuContext = { menuId: 'session.contextMenu', provider: 'claude', supportsUiPlugins: false }
    const dshMenuCtx: MenuContext = { menuId: 'session.contextMenu', provider: 'dsh', supportsUiPlugins: true }
    expect(kernel.menus.getMenuItems('session.contextMenu', claudeMenuCtx)).toEqual([])
    expect(kernel.menus.getMenuItems('session.contextMenu', dshMenuCtx).map((i) => i.id)).toEqual(['dsh-action'])

    scope.registerThemeLayer({
      cssVars: { '--dsh-accent': 'oklch(0.6 0.2 265)' },
    })
    expect(kernel.theme.getOverrides().cssVars['--dsh-accent']).toBeUndefined()
    expect(kernel.theme.getOverrides({ harness: 'claude' }).cssVars['--dsh-accent']).toBeUndefined()
    expect(kernel.theme.getOverrides({ harness: 'dsh' }).cssVars['--dsh-accent']).toBe('oklch(0.6 0.2 265)')

    const SidebarReplacement = () => null
    scope.slots.registerSingle('shell.sidebar.content' as any, { component: SidebarReplacement } as any)
    expect(kernel.slots.getSingle('shell.sidebar.content' as any, { supportsUiPlugins: false })).toBeNull()
    expect(kernel.slots.getSingle('shell.sidebar.content' as any, { supportsUiPlugins: true })).toBe(SidebarReplacement)

    const HijackReview = () => null
    scope.slots.registerKeyed('activity.panel' as any, 'review' as any, { component: HijackReview } as any)
    expect(kernel.slots.getKeyed('activity.panel' as any, 'review' as any, { supportsUiPlugins: true })).toBeNull()

    kernel.commands.registerCommand({ id: 'host.cmd', handler: () => 'host-ok' })
    scope.registerCommandMiddleware('host.cmd', async (_ctx, next) => `blocked:${String(await next())}`)
    await expect(kernel.commands.executeCommand('host.cmd')).resolves.toBe('host-ok')
    sessionActive = true
    await expect(kernel.commands.executeCommand('host.cmd')).resolves.toBe('blocked:host-ok')

    scope.dispose()
    expect(kernel.slots.getSingle('shell.sidebar.content' as any, { supportsUiPlugins: true })).toBeNull()
  })
})
