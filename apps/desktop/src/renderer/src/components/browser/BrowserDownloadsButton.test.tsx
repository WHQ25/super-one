/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { BrowserDownloadItem } from '@superone/shared/agent-types'
import { useBrowserDownloadsStore } from '@/stores/browser-downloads'
import { BrowserDownloadsButton } from './BrowserDownloadsButton'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

function installWindowAppMock() {
  const api = {
    browserDownloadList: vi.fn(async () => []),
    browserDownloadCancel: vi.fn(async () => true),
    browserDownloadOpen: vi.fn(async () => ''),
    browserDownloadShowInFolder: vi.fn(async () => undefined),
    browserDownloadClear: vi.fn(async () => []),
  }
  ;(window as unknown as { app: typeof api }).app = api
  return api
}

function makeItem(overrides: Partial<BrowserDownloadItem> = {}): BrowserDownloadItem {
  return {
    id: 'dl-1',
    url: 'https://example.com/file.zip',
    filename: 'file.zip',
    path: '/tmp/file.zip',
    receivedBytes: 512,
    totalBytes: 1024,
    state: 'progressing',
    paused: false,
    startedAt: 1000,
    ...overrides,
  }
}

describe('BrowserDownloadsButton', () => {
  beforeEach(() => {
    useBrowserDownloadsStore.setState({
      items: [],
      loaded: true,
      hasUnseenCompletion: false,
    })
  })

  afterEach(cleanup)

  it('renders nothing when there are no downloads', () => {
    installWindowAppMock()
    const { container } = render(<BrowserDownloadsButton />)
    expect(container.firstChild).toBeNull()
  })

  it('shows only the icon without opening the popover when a download starts', () => {
    installWindowAppMock()
    render(<BrowserDownloadsButton />)
    act(() => {
      useBrowserDownloadsStore.getState().upsert(makeItem({ id: 'dl-new', filename: 'installer.dmg' }))
    })

    expect(screen.getByRole('button', { name: 'chat.browser.downloads' })).toBeTruthy()
    expect(screen.queryByText('installer.dmg')).toBeNull()
  })

  it('shows progressing and completed items in popover and triggers actions', async () => {
    const api = installWindowAppMock()
    useBrowserDownloadsStore.setState({
      items: [
        makeItem({ id: 'dl-active', filename: 'bundle.tar.gz', receivedBytes: 512 * 1024, totalBytes: 1024 * 1024, state: 'progressing' }),
        makeItem({ id: 'dl-done', filename: 'report.pdf', path: '/tmp/report.pdf', receivedBytes: 2048, totalBytes: 2048, state: 'completed', completedAt: 2000 }),
      ],
    })

    render(<BrowserDownloadsButton />)
    const trigger = screen.getByRole('button', { name: 'chat.browser.downloads' })
    fireEvent.click(trigger)

    expect(screen.getByText('bundle.tar.gz')).toBeTruthy()
    expect(screen.getByText('512 KB / 1.00 MB · 50%')).toBeTruthy()
    expect(screen.getByText('report.pdf')).toBeTruthy()
    expect(screen.getByText('2.00 KB · chat.browser.downloadCompleted')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'chat.browser.downloadCancel' }))
    expect(api.browserDownloadCancel).toHaveBeenCalledWith('dl-active')

    fireEvent.click(screen.getByRole('button', { name: 'chat.browser.downloadOpen' }))
    expect(api.browserDownloadOpen).toHaveBeenCalledWith('/tmp/report.pdf')

    fireEvent.click(screen.getByRole('button', { name: 'chat.browser.downloadShowInFolder' }))
    expect(api.browserDownloadShowInFolder).toHaveBeenCalledWith('/tmp/report.pdf')

    fireEvent.click(screen.getByRole('button', { name: 'chat.browser.downloadsClear' }))
    expect(api.browserDownloadClear).toHaveBeenCalledWith(undefined)
  })
})
