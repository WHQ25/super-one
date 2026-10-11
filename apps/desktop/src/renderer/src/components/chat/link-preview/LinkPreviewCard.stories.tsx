import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Globe } from 'lucide-react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { LinkPreviewCard } from './LinkPreviewCard'
import type { LinkPreviewState } from './link-preview-loader'

const CARD_IMAGE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#fff"/><text x="80" y="150" font-family="sans-serif" font-size="40" fill="#57606a">New Release rust-v0.162.1</text><text x="80" y="260" font-family="sans-serif" font-size="96" font-weight="700" fill="#1f2328">0.162.1</text><text x="80" y="350" font-family="sans-serif" font-size="44" font-weight="600" fill="#57606a">Bug Fixes</text><rect y="600" width="1200" height="30" fill="#d4a27f"/></svg>')

const READY: LinkPreviewState = {
  status: 'ready',
  preview: {
    title: 'Release 0.162.1 · openai/codex',
    description: 'Bug Fixes Fixed a TUI crash when asynchronous questions contain multiple lines, preserving line breaks and complete hyperlinks.',
    siteName: 'GitHub',
    image: CARD_IMAGE,
  },
}

const meta = {
  title: 'Chat/LinkPreviewCard',
  component: LinkPreviewCard,
  args: {
    href: 'https://github.com/openai/codex/releases/tag/rust-v0.162.1',
    state: READY,
    favicon: <Globe className="text-muted-foreground" />,
    onOpenInApp: fn(),
    onOpenExternal: fn(),
    onCopy: fn(async () => true),
  },
  decorators: [(Story) => <div className="w-[22rem] overflow-hidden rounded-xl border bg-popover shadow-md"><Story /></div>],
} satisfies Meta<typeof LinkPreviewCard>

export default meta
type Story = StoryObj<typeof meta>

/** Hovered, summary still loading: the header alone, with a spinner. */
export const Loading: Story = { args: { state: { status: 'loading' } } }

export const WithImage: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open in built-in browser' }))
    await expect(args.onOpenInApp).toHaveBeenCalledOnce()
    await userEvent.click(canvas.getByRole('button', { name: 'Copy link' }))
    await expect(args.onCopy).toHaveBeenCalledOnce()
    await expect(await canvas.findByRole('button', { name: 'Copied' })).toBeVisible()
  },
}

export const WithoutImage: Story = {
  args: { state: { status: 'ready', preview: { ...READY.preview, image: null } } },
}

/** A page without Open Graph tags keeps the header alone. */
export const NoSummary: Story = { args: { state: { status: 'empty' } } }

export const LongContent: Story = {
  args: {
    href: `https://docs.example.com/${'deeply/nested/'.repeat(8)}page`,
    state: {
      status: 'ready',
      preview: {
        title: 'A very long page title that keeps going well past two lines of the preview card so it has to be clamped neatly',
        description: 'A description long enough to wrap several times. '.repeat(8),
        siteName: null,
        image: CARD_IMAGE,
      },
    },
  },
}

export const Narrow: Story = {
  decorators: [(Story) => <div className="w-60 overflow-hidden rounded-xl border bg-popover"><Story /></div>],
}

/** The summary arriving after the header, as on hover: the body slides open. */
export const ExpandOnLoad: Story = {
  render: function Render(args) {
    const [state, setState] = useState<LinkPreviewState>({ status: 'loading' })
    return (
      <div>
        <LinkPreviewCard {...args} state={state} />
        <button type="button" className="m-3 text-xs underline" onClick={() => setState((s) => (s.status === 'loading' ? READY : { status: 'loading' }))}>
          Toggle loaded
        </button>
      </div>
    )
  },
}
