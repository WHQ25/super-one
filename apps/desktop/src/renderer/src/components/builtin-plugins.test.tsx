/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { createClientKernel } from '@superone/client-kernel'

vi.mock('@/components/activity/activity-panel-api', () => ({
  openReviewTab: vi.fn(),
  openTrajectoryTab: vi.fn(),
}))

const { registerReviewPlugin } = await import('./review/review-plugin')
const { registerTrajectoryPlugin } = await import('./trajectory/trajectory-plugin')

describe('Built-in Review and Trajectory de-privileged renderer plugins', () => {
  it('tears down Review Renderer panel, command, and launcher menu on dispose()', () => {
    const clientKernel = createClientKernel()
    const rendererScope = registerReviewPlugin(clientKernel)

    expect(clientKernel.slots.hasKeyed('activity.panel', 'review')).toBe(true)
    expect(clientKernel.commands.hasCommand('review.open')).toBe(true)
    expect(
      clientKernel.menus
        .getMenuItems('activity.launcher', { menuId: 'activity.launcher', hasFolder: true })
        .map((i) => i.id),
    ).toEqual(['review'])

    rendererScope.dispose()

    expect(clientKernel.slots.hasKeyed('activity.panel', 'review')).toBe(false)
    expect(clientKernel.commands.hasCommand('review.open')).toBe(false)
    expect(
      clientKernel.menus.getMenuItems('activity.launcher', { menuId: 'activity.launcher', hasFolder: true }),
    ).toEqual([])
  })

  it('tears down Trajectory panel, command, and capability-gated launcher menu on dispose()', () => {
    const clientKernel = createClientKernel()
    const scope = registerTrajectoryPlugin(clientKernel)

    expect(clientKernel.slots.hasKeyed('activity.panel', 'trajectory')).toBe(true)
    expect(clientKernel.commands.hasCommand('trajectory.open')).toBe(true)

    expect(
      clientKernel.menus.getMenuItems('activity.launcher', {
        menuId: 'activity.launcher',
        sessionId: 's1',
        supportsUiPlugins: false,
      }),
    ).toEqual([])
    expect(
      clientKernel.menus
        .getMenuItems('activity.launcher', {
          menuId: 'activity.launcher',
          sessionId: 's1',
          supportsUiPlugins: true,
        })
        .map((i) => i.id),
    ).toEqual(['trajectory'])

    scope.dispose()

    expect(clientKernel.slots.hasKeyed('activity.panel', 'trajectory')).toBe(false)
    expect(clientKernel.commands.hasCommand('trajectory.open')).toBe(false)
    expect(
      clientKernel.menus.getMenuItems('activity.launcher', {
        menuId: 'activity.launcher',
        sessionId: 's1',
        supportsUiPlugins: true,
      }),
    ).toEqual([])
  })
})
