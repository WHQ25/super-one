import type { Meta, StoryObj } from '@storybook/react-vite'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { expect, fn as mockFn, screen, userEvent, waitFor, within } from 'storybook/test'
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
  mockIpc('app', 'getMediaServerPort', async () => null)
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
    await hoverLink(within(canvasElement).getByRole('link', { name: /release notes/ }))
    await waitFor(() => expect(screen.getByText('Releases · openai/codex')).toBeVisible(), { timeout: 2000 })
    await userEvent.unhover(within(canvasElement).getByRole('link', { name: /release notes/ }))
    await waitFor(() => expect(screen.queryByText('Releases · openai/codex')).toBeNull())
  },
}

async function hoverLink(link: Element) {
  const rect = link.getClientRects()[0]!
  await userEvent.pointer({ target: link, coords: { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } })
}

/** Links in a sent user bubble draw as chat links and preview on hover. */
export const UserBubble: Story = {
  render: () => (
    <DesktopUserBubblePorts>
      <div className="rounded-2xl bg-muted px-3 py-2"><UserTextPresenter text={LINKED_TEXT} /></div>
    </DesktopUserBubblePorts>
  ),
}

function Composer({ content = `<p>${LINKED_TEXT}</p><p>打开https://github.com/openai/codex/releases，看看。</p>` }: { content?: string }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false, underline: false }), WebLinkDecoration],
    content,
  })
  return (
    <div className="rounded-xl border px-3 py-2">
      <EditorContent editor={editor} className="[&_.tiptap]:outline-none" />
      <ComposerLinkPreview editor={editor} />
    </div>
  )
}

/** Hover the first line of a wrapped link, far from its overall left edge. */
async function checkPointerPlacement(link: Element) {
  const lines = Array.from(link.getClientRects())
  expect(lines.length).toBeGreaterThan(1)
  const first = lines[0]!
  const x = first.right - Math.min(16, first.width / 2)
  const y = first.top + first.height / 2
  await userEvent.pointer({ target: link, coords: { clientX: x, clientY: y } })
  await waitFor(() => {
    const card = document.querySelector('[data-slot="hover-card-content"], [data-slot="popover-content"]')
    expect(card).toBeVisible()
    const rect = card!.getBoundingClientRect()
    if (x - rect.width / 2 >= 6 && x + rect.width / 2 + 6 <= document.documentElement.clientWidth) {
      expect(Math.abs(rect.left + rect.width / 2 - x)).toBeLessThan(2)
    } else {
      expect(rect.left).toBeLessThanOrEqual(x)
      expect(rect.right).toBeGreaterThanOrEqual(x)
    }
    expect(rect.left).toBeGreaterThanOrEqual(6)
    expect(rect.right).toBeLessThanOrEqual(innerWidth - 6)
    expect(rect.top - first.bottom).toBeGreaterThanOrEqual(6)
    expect(rect.top - first.bottom).toBeLessThanOrEqual(10)
  })
  const card = document.querySelector('[data-slot="popover-content"]')!
  await Promise.all(card.getAnimations().map((animation) => animation.finished))
  const initial = card.getBoundingClientRect()
  const second = lines[1]!
  await userEvent.pointer({ target: link, coords: { clientX: second.left + Math.min(4, second.width / 4), clientY: second.top + second.height / 2 } })
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const afterMove = card.getBoundingClientRect()
  expect(Math.abs(afterMove.left - initial.left)).toBeLessThan(1)
  expect(Math.abs(afterMove.top - initial.top)).toBeLessThan(1)
  await userEvent.unhover(link)
  await waitFor(() => expect(document.querySelector('[data-slot="popover-content"]')).toBeNull())
  await userEvent.pointer({ target: link, coords: { clientX: x, clientY: first.bottom - 1 } })
  await waitFor(() => {
    const reopened = document.querySelector('[data-slot="popover-content"]')
    expect(reopened).toBeVisible()
    expect(Math.abs(reopened!.getBoundingClientRect().top - initial.top)).toBeLessThan(1)
  })
}

/** Reproduces a link spanning the end of one line and the start of the next. */
export const WrappedLink: Story = {
  render: () => (
    <p className="chat-md w-[min(28rem,80vw)] text-base leading-7">
      A long introduction puts the link here: <WebLink href="https://example.com/plain">read the documentation for a detailed explanation of this wrapped link</WebLink>.
    </p>
  ),
  play: async ({ canvasElement }) => {
    await checkPointerPlacement(within(canvasElement).getByRole('link'))
  },
}

export const WrappedComposerLink: Story = {
  render: () => (
    <div className="w-[min(28rem,80vw)] break-all text-base leading-7">
      <Composer content="<p>Read the documentation at https://example.com/documentation/this-is-a-long-link-that-wraps-over-multiple-lines for details.</p>" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await checkPointerPlacement(canvasElement.querySelector('.web-link')!)
  },
}

const LONG_URL = 'https://github.com/wheresryan22/anatomy-of-a-very-long-repository.git'

/** A URL too long to fit beside its favicon still starts on the icon's line. */
async function expectFaviconBesideUrl(canvasElement: HTMLElement) {
  await waitFor(() => {
    // The mocked favicon lookup answers null, so every link draws the globe.
    const iconBox = canvasElement.querySelector('.lucide-globe')!.getBoundingClientRect()
    const range = document.createRange()
    range.setStart(document.createTreeWalker(canvasElement.querySelector('.web-link')!, NodeFilter.SHOW_TEXT).nextNode()!, 0)
    range.setEnd(range.startContainer, 1)
    const char = range.getBoundingClientRect()
    const middle = iconBox.top + iconBox.height / 2
    expect(middle).toBeGreaterThan(char.top)
    expect(middle).toBeLessThan(char.bottom)
    expect(iconBox.right).toBeLessThanOrEqual(char.left)
  })
}

export const LongUrlInBubble: Story = {
  render: () => (
    <DesktopUserBubblePorts>
      <div className="w-64 rounded-2xl bg-muted px-3 py-2 wrap-break-word"><UserTextPresenter text={`${LONG_URL} 看看这个项目`} /></div>
    </DesktopUserBubblePorts>
  ),
  play: async ({ canvasElement }) => expectFaviconBesideUrl(canvasElement),
}

export const LongUrlInComposer: Story = {
  render: () => (
    <div className="w-64 wrap-break-word">
      <Composer content={`<p>看看 ${LONG_URL} 这个项目</p>`} />
    </div>
  ),
  play: async ({ canvasElement }) => expectFaviconBesideUrl(canvasElement),
}

/** The growing preview must flip above the cursor and stay inside a narrow viewport. */
export const ViewportEdge: Story = {
  render: () => (
    <div className="fixed right-2 bottom-2">
      <WebLink href="https://github.com/openai/codex/releases">Preview at the window edge</WebLink>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link')
    const rect = link.getBoundingClientRect()
    const y = rect.top + rect.height / 2
    await hoverLink(link)
    await userEvent.pointer({ target: link, coords: { clientX: rect.right - 4, clientY: y } })
    await waitFor(() => expect(screen.getByText('Releases · openai/codex')).toBeVisible(), { timeout: 2000 })
    await waitFor(() => {
      const card = document.querySelector('[data-slot="popover-content"]')!.getBoundingClientRect()
      expect(card.left).toBeGreaterThanOrEqual(6)
      expect(card.right).toBeLessThanOrEqual(innerWidth - 6)
      expect(card.top).toBeGreaterThanOrEqual(6)
      expect(card.bottom).toBeLessThanOrEqual(y - 8)
    })
  },
}

/** The pointer can enter the preview without moving it or losing access to its actions. */
export const PreviewActions: Story = {
  render: () => <WebLink href="https://example.com/plain">Preview actions</WebLink>,
  play: async ({ canvasElement }) => {
    const openExternal = mockFn()
    mockIpc('app', 'openExternalLink', openExternal)
    const link = within(canvasElement).getByRole('link')
    await hoverLink(link)
    await waitFor(() => expect(screen.getByRole('button', { name: /external browser|外部浏览器/ })).toBeVisible(), { timeout: 2000 })
    const button = screen.getByRole('button', { name: /external browser|外部浏览器/ })
    await userEvent.unhover(link)
    await userEvent.hover(button)
    // Longer than the close delay: hovering the card must cancel it.
    await new Promise((resolve) => setTimeout(resolve, 350))
    await expect(button).toBeVisible()
    await userEvent.click(button)
    await expect(openExternal).toHaveBeenCalledWith('https://example.com/plain')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  },
}

export const KeyboardPreview: Story = {
  render: () => <WebLink href="https://example.com/plain">Keyboard preview</WebLink>,
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link')
    await userEvent.tab()
    await expect(link).toHaveFocus()
    await waitFor(() => {
      const card = document.querySelector('[data-slot="popover-content"]')
      expect(card).toBeVisible()
      expect(card!.getBoundingClientRect().top).toBeGreaterThan(link.getBoundingClientRect().bottom)
    })
    await expect(link).toHaveFocus()
  },
}

/** Links typed or pasted into the composer: styled in place, opened only from the hover card. */
export const ComposerDraft: Story = {
  render: () => <Composer />,
  play: async ({ canvasElement }) => {
    const [link] = canvasElement.querySelectorAll('.web-link')
    await hoverLink(link!)
    await waitFor(() => expect(screen.getByText('Releases · openai/codex')).toBeVisible(), { timeout: 2000 })
  },
}
