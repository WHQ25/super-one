import type { Meta, StoryObj } from '@storybook/react-vite'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import type { LinkPreview } from '@superone/shared/web-links'
import { UserTextPresenter } from '@superone/chat-view/presenters/UserText'
import { mockIpc } from '../../../../../../.storybook/mock-ipc'
import { DesktopUserBubblePorts } from '../user-bubble-ports'
import { WebLinkDecoration } from '../web-link-decoration'
import { ComposerLinkPreview } from './ComposerLinkPreview'
import { WebLink } from './WebLink'

const CARD_IMAGE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/></svg>')
const PREVIEWS: Record<string, LinkPreview | null> = {
  'https://github.com/openai/codex/releases': { title: 'Releases · openai/codex', description: 'Lightweight coding agent that runs in your terminal.', siteName: 'GitHub', image: CARD_IMAGE },
  'https://example.com/plain': null,
}
const LINKED_TEXT = 'Compare https://github.com/openai/codex/releases with https://example.com/plain, then reply.'

/** Answers like the main process after a short network delay, so the card opens on its header first. */
function mockLinkPreviews() {
  mockIpc('app', 'resolveLinkPreview', (url) => new Promise((resolve) => setTimeout(() => resolve(PREVIEWS[url as string] ?? null), 400)))
  mockIpc('app', 'cacheRemoteImage', async (url) => url)
  mockIpc('app', 'resolveFavicon', async () => null)
}

const meta = {
  title: 'Chat/WebLink',
  decorators: [(Story) => { mockLinkPreviews(); return <div className="max-w-xl p-6 text-sm"><Story /></div> }],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** A markdown link: hover previews, click still opens as before. */
export const MarkdownLink: Story = {
  render: () => (
    <p className="chat-md">
      See the <WebLink href="https://github.com/openai/codex/releases" data-streamdown="link">release notes</WebLink> for details.
    </p>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('link', { name: /release notes/ }))
    await waitFor(() => expect(screen.getByText('Releases · openai/codex')).toBeVisible(), { timeout: 2000 })
    await userEvent.unhover(within(canvasElement).getByRole('link', { name: /release notes/ }))
    await waitFor(() => expect(screen.queryByText('Releases · openai/codex')).toBeNull())
  },
}

/** Links in a sent user bubble draw as chat links and preview on hover. */
export const UserBubble: Story = {
  render: () => (
    <DesktopUserBubblePorts>
      <div className="rounded-2xl bg-muted px-3 py-2"><UserTextPresenter text={LINKED_TEXT} /></div>
    </DesktopUserBubblePorts>
  ),
}

function Composer() {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false, underline: false }), WebLinkDecoration],
    content: `<p>${LINKED_TEXT}</p><p>打开https://github.com/openai/codex/releases，看看。</p>`,
  })
  return (
    <div className="rounded-xl border px-3 py-2">
      <EditorContent editor={editor} className="[&_.tiptap]:outline-none" />
      <ComposerLinkPreview editor={editor} />
    </div>
  )
}

/** Links typed or pasted into the composer: styled in place, opened only from the hover card. */
export const ComposerDraft: Story = {
  render: () => <Composer />,
  play: async ({ canvasElement }) => {
    const [link] = canvasElement.querySelectorAll('.web-link')
    await userEvent.hover(link!)
    await waitFor(() => expect(screen.getByText('Releases · openai/codex')).toBeVisible(), { timeout: 2000 })
  },
}
