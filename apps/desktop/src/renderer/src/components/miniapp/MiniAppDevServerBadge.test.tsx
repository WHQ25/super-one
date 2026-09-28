/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { url?: string }) => `${key}:${opts?.url}` }),
}))

import { MiniAppDevServerBadge } from './MiniAppDevServerBadge'

const devServer = vi.fn<(appId: string) => Promise<string | null>>()

describe('MiniAppDevServerBadge', () => {
  beforeEach(() => {
    devServer.mockReset()
    ;(window as unknown as { miniapp: { devServer: typeof devServer } }).miniapp = { devServer }
  })

  it('names the dev server the app hot-reloads from', async () => {
    devServer.mockResolvedValue('http://localhost:5173')
    render(<MiniAppDevServerBadge appId="tasks" />)
    expect(await screen.findByRole('img')).toHaveAttribute('aria-label', 'activity.miniAppDevServer:http://localhost:5173')
    expect(devServer).toHaveBeenCalledWith('tasks')
  })

  it('renders nothing while the app serves its build', async () => {
    devServer.mockResolvedValue(null)
    const { container } = render(<MiniAppDevServerBadge appId="tasks" />)
    await waitFor(() => expect(devServer).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('stops asking once the tab unmounts', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      devServer.mockResolvedValue(null)
      const { unmount } = render(<MiniAppDevServerBadge appId="tasks" />)
      vi.advanceTimersByTime(3_000)
      expect(devServer).toHaveBeenCalledTimes(2)
      unmount()
      vi.advanceTimersByTime(9_000)
      expect(devServer).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
