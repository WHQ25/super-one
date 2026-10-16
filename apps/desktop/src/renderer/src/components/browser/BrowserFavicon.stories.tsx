import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor } from 'storybook/test'
import { Globe } from 'lucide-react'
import { BrowserFavicon } from './BrowserFavicon'

const ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="4" fill="#2563eb"/><circle cx="8" cy="8" r="4" fill="white"/></svg>')}`

const meta = {
  title: 'Browser/Favicon',
  component: BrowserFavicon,
  args: {
    fallback: <Globe aria-label="Fallback icon" className="size-4 text-muted-foreground" />,
    className: 'size-4',
    preferSrc: true,
  },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof BrowserFavicon>
export default meta
type Story = StoryObj<typeof meta>

export const LiveIcon: Story = { args: { src: ICON } }
export const Missing: Story = {}
export const Broken: Story = {
  args: { src: 'data:image/png;base64,broken' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('img')).toBeNull())
    await expect(canvasElement.querySelector('[aria-label="Fallback icon"]')).toBeVisible()
  },
}
export const BrokenDark: Story = { ...Broken, globals: { theme: 'dark' } }
