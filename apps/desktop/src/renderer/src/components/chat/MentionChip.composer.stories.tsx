import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { userEvent } from 'storybook/test'
import { encodeMcpMentionValue, type McpMentionReadResource } from '@superone/shared/mcp-app-mentions'
import { encodeGitMentionValue } from '@superone/shared/git-mention-query'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { rememberMcpMentionIcons } from '@/components/mcp-apps/mention-icons'
import { MentionNode } from './mention-node'

const PROJECT = '/storybook/mention-composer'
const CAD_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="none" stroke="#27272a" stroke-width="3" stroke-linejoin="round" d="M9.5 4.75h13L29 16l-6.5 11.25h-13L3 16zM13 10.8h6l3 5.2-3 5.2h-6L10 16z"/></svg>')
rememberMcpMentionIcons([{ server: 'bits-and-bolts', tool: 'search_mentions', title: 'Bits & Bolts', icon: CAD_ICON, items: [] }])

type Answer = 'text' | 'binary' | 'failed'
const HEX_BOLT = '# Hex bolt M8 × 40\n\nISO 4017 hex head screw, fully threaded.\n\nTags: fastener, metric, iso-4017'
let story = 0

/**
 * The composer as ChatInput builds it, reduced to the nodes these chips need: the
 * production MentionNode draws the chips. `answer` is what the preview read returns.
 */
function Composer({ answer, width = 560 }: { answer: Answer; width?: number }) {
  // A session per render so the preview cache never leaks between stories.
  const [sessionId] = useState(() => `story-composer-${answer}-${++story}`)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const env = (window as unknown as { environment?: Record<string, unknown> }).environment ?? {}
    ;(window as unknown as { environment: Record<string, unknown> }).environment = {
      ...env,
      // The file chip's right-click menu asks which MCP Apps open the file: none here.
      mcpAppFileHandlers: async () => ({ ok: true, value: { handlers: [] } }),
      mcpAppMentionRead: async (_project: string, _session: string, targets: Array<{ server: string; uri: string }>) => ({
        ok: true,
        value: targets.map((target): McpMentionReadResource => answer === 'text'
          ? { ...target, mimeType: 'text/markdown', text: HEX_BOLT }
          : { ...target, skipped: answer }),
      }),
    }
    const project = createDefaultProjectState()
    project._activeSessionId = sessionId
    project._sessions = { [sessionId]: createDefaultPerSessionState() }
    useChatStore.setState({ activeProject: PROJECT, projectSessions: { [PROJECT]: project } })
    setReady(true)
  }, [answer, sessionId])
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, codeBlock: false, horizontalRule: false, listItem: false, code: false, bold: false, italic: false, strike: false, dropcursor: false }), MentionNode],
    editorProps: { attributes: { class: 'w-full min-h-9 text-sm leading-6 outline-none text-foreground' } },
    content: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Check ' },
          { type: 'mention', attrs: { kind: 'mcp-resource', value: encodeMcpMentionValue('bits-and-bolts', 'cad://parts/hex-bolt-m8'), displayName: 'Hex bolt M8 × 40' } },
          { type: 'text', text: ' with ' },
          { type: 'mention', attrs: { kind: 'agent-profile', value: 'codex-base', displayName: 'Codex' } },
          { type: 'text', text: ' on ' },
          { type: 'mention', attrs: { kind: 'git', value: encodeGitMentionValue('branch', 'main'), displayName: 'main' } },
          { type: 'text', text: ' against ' },
          { type: 'mention', attrs: { kind: 'file', value: 'docs/torque.md', displayName: 'torque.md' } },
        ],
      }],
    },
  })
  if (!ready) return null
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2" style={{ width, maxWidth: '100%' }}>
      <EditorContent editor={editor} />
    </div>
  )
}

const meta = {
  title: 'Chat/MentionChip/Composer',
  component: Composer,
  parameters: { layout: 'padded' },
  play: async ({ canvasElement }) => {
    const chip = await new Promise<HTMLElement>((resolve) => {
      const find = () => {
        const found = canvasElement.querySelector<HTMLElement>('[data-mention-kind="mcp-resource"] .mention-chip__label')
        if (found) resolve(found)
        else setTimeout(find, 50)
      }
      find()
    })
    await userEvent.hover(chip)
  },
} satisfies Meta<typeof Composer>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The MCP chip sits with @collaborator and @git chips in the same blended style; hovering
 * it reads the resource and shows what sending will inline.
 */
export const PreviewContent: Story = { args: { answer: 'text' } }

/** Binary content is never inlined: the preview says only the link will go. */
export const PreviewLinkOnly: Story = { args: { answer: 'binary' } }

/** The server did not answer: sending will try again. */
export const PreviewFailed: Story = { args: { answer: 'failed' } }

export const Narrow: Story = { args: { answer: 'text', width: 320 } }

/** A file chip in the composer acts like FileChip: click opens the file, the icon drags it out, right-click shows the file menu. */
export const FileMentionContextMenu: Story = {
  args: { answer: 'text' },
  play: async ({ canvasElement }) => {
    const chip = await new Promise<HTMLElement>((resolve) => {
      const find = () => {
        const found = canvasElement.querySelector<HTMLElement>('[data-mention-kind="file"]')
        if (found) resolve(found)
        else setTimeout(find, 50)
      }
      find()
    })
    await userEvent.pointer({ keys: '[MouseRight]', target: chip })
  },
}
