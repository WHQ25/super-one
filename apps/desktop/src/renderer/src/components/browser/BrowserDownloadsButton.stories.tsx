import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { BrowserDownloadItem } from '@superone/shared/agent-types'
import { useBrowserDownloadsStore } from '@/stores/browser-downloads'
import { BrowserDownloadsButton } from './BrowserDownloadsButton'

function DownloadsScene({
  items,
  hasUnseenCompletion = false,
  narrow = false,
}: {
  items: BrowserDownloadItem[]
  hasUnseenCompletion?: boolean
  narrow?: boolean
}) {
  useEffect(() => {
    useBrowserDownloadsStore.setState({
      items,
      loaded: true,
      hasUnseenCompletion,
    })
    return () => {
      useBrowserDownloadsStore.setState({
        items: [],
        loaded: false,
        hasUnseenCompletion: false,
      })
    }
  }, [items, hasUnseenCompletion])

  return (
    <div className="flex min-h-[340px] items-start justify-end bg-background p-6">
      <div
        className={`flex h-9 items-center justify-between gap-2 rounded-md border border-border px-2 ${
          narrow ? 'w-72' : 'w-[460px]'
        }`}
      >
        <div className="h-6 flex-1 rounded-full bg-muted/60 px-3 text-xs leading-6 text-muted-foreground">
          https://example.com/releases
        </div>
        <BrowserDownloadsButton />
      </div>
    </div>
  )
}

const meta: Meta<typeof DownloadsScene> = {
  title: 'Browser/BrowserDownloadsButton',
  component: DownloadsScene,
}

export default meta
type Story = StoryObj<typeof DownloadsScene>

export const MixedStates: Story = {
  args: {
    items: [
      {
        id: 'dl-1',
        url: 'https://example.com/superone-desktop-mac-arm64.dmg',
        filename: 'superone-desktop-mac-arm64.dmg',
        path: '/Users/demo/Downloads/superone-desktop-mac-arm64.dmg',
        receivedBytes: 42 * 1024 * 1024,
        totalBytes: 120 * 1024 * 1024,
        state: 'progressing',
        paused: false,
        startedAt: 1700000000000,
      },
      {
        id: 'dl-2',
        url: 'https://example.com/very-long-archive-name-with-build-metadata-2026-11-25.tar.gz',
        filename: 'very-long-archive-name-with-build-metadata-2026-11-25.tar.gz',
        path: '/Users/demo/Downloads/very-long-archive-name-with-build-metadata-2026-11-25.tar.gz',
        receivedBytes: 8.4 * 1024 * 1024,
        totalBytes: 0,
        state: 'progressing',
        paused: false,
        startedAt: 1700000001000,
      },
      {
        id: 'dl-3',
        url: 'https://example.com/release-notes.pdf',
        filename: 'release-notes.pdf',
        path: '/Users/demo/Downloads/release-notes.pdf',
        receivedBytes: 2.3 * 1024 * 1024,
        totalBytes: 2.3 * 1024 * 1024,
        state: 'completed',
        paused: false,
        startedAt: 1700000002000,
        completedAt: 1700000005000,
      },
      {
        id: 'dl-4',
        url: 'https://example.com/broken.zip',
        filename: 'broken.zip',
        path: '/Users/demo/Downloads/broken.zip',
        receivedBytes: 120 * 1024,
        totalBytes: 1024 * 1024,
        state: 'interrupted',
        paused: false,
        startedAt: 1700000003000,
        completedAt: 1700000004000,
      },
      {
        id: 'dl-5',
        url: 'https://example.com/cancelled.iso',
        filename: 'cancelled.iso',
        path: '/Users/demo/Downloads/cancelled.iso',
        receivedBytes: 400 * 1024,
        totalBytes: 800 * 1024 * 1024,
        state: 'cancelled',
        paused: false,
        startedAt: 1700000004000,
        completedAt: 1700000004500,
      },
    ],
  },
}

export const CompletedWithBadge: Story = {
  args: {
    hasUnseenCompletion: true,
    items: [
      {
        id: 'dl-done',
        url: 'https://example.com/design-tokens.json',
        filename: 'design-tokens.json',
        path: '/Users/demo/Downloads/design-tokens.json',
        receivedBytes: 18432,
        totalBytes: 18432,
        state: 'completed',
        paused: false,
        startedAt: 1700000000000,
        completedAt: 1700000001000,
      },
    ],
  },
}

export const NarrowToolbar: Story = {
  args: {
    narrow: true,
    items: MixedStates.args?.items ?? [],
  },
}

export const EmptyHidden: Story = {
  args: {
    items: [],
  },
}
