import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@superone/shared/agent-types'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { ChatContent } from './ChatContent'
import { mockTranscriptIpc } from './chat-transcript-story-mocks'

mockTranscriptIpc()

const PROJECT = '__markdown_width__'
const SESSION = 'markdown-width'
const TEXT = [
  'This paragraph keeps the normal reading width while the table and diagram use the space on both sides. Resize the chat pane to check how they adapt.',
  '',
  '| Stage | Desktop owner | Mobile owner | Request | Response | Persistence | Recovery | Notes |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| Compose | Chat composer | Native composer | sendMessage | accepted | message history | restore draft | Preserve user input |',
  '| Execute | Session backend | Remote transport | startTurn | content delta | event stream | reconnect | Keep the active turn visible |',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Compose message] --> B[Validate request] --> C[Start session turn] --> D[Run agent tools] --> E[Stream response] --> F[Persist history] --> G[Render transcript]',
  '```',
  '',
  'Ordinary code blocks also keep the reading width:',
  '',
  '```ts',
  'const readingWidth = "unchanged"',
  '```',
].join('\n')
const COMPACT_TEXT = [
  'These blocks fit within the normal reading column.',
  '',
  '| Stage | Status |',
  '| --- | --- |',
  '| Compose | Ready |',
  '| Execute | Complete |',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Compose / 输入] --> B[Done / 完成]',
  '```',
].join('\n')

function MarkdownWidthPreview({ width = 1200, compact = false, streaming = false, invalid = false, virtual = false, codex = false, rail = false }: {
  width?: number
  compact?: boolean
  streaming?: boolean
  invalid?: boolean
  virtual?: boolean
  codex?: boolean
  rail?: boolean
}) {
  const [ready, setReady] = useState(false)
  const [paneWidth, setPaneWidth] = useState(width)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => setPaneWidth(width), [width])
  useEffect(() => {
    const previous = useChatStore.getState()
    const app = useAppStore.getState()
    const text = streaming
      ? `${TEXT.split('```mermaid')[0]}\`\`\`mermaid\nflowchart LR\n  A[Compose message] --> B[Validate request]\n`
      : invalid ? TEXT.replace('A[Compose message]', 'A[Unclosed bracket') : compact ? COMPACT_TEXT : TEXT
    const message: ChatMessage = {
      id: 'wide-markdown',
      role: 'assistant',
      providerId: codex ? 'codex' : 'claude',
      status: streaming ? 'streaming' : 'complete',
      createdAt: '2026-10-11T00:00:00.000Z',
      content: [{ type: 'text', text }],
      ...(codex ? { metadata: { codex: {
        threadId: 'markdown-width',
        usage: null,
        items: [{ id: 'reply', type: 'agent_message' as const, text }],
      } } } : {}),
    }
    const history: ChatMessage[] = virtual ? Array.from({ length: 10 }, (_, index) => ({
      ...message,
      id: `history-${index}`,
      content: [{ type: 'text', text: `Earlier response ${index}.` }],
      metadata: undefined,
    })) : []
    const providerId = codex ? 'codex' : 'claude'
    const userTurn = (id: string, text: string, createdAt: string): ChatMessage => ({
      id, role: 'user', providerId, status: 'complete', createdAt, content: [{ type: 'text', text }],
    })
    useChatStore.setState({
      activeProject: PROJECT,
      projectSessions: {
        ...previous.projectSessions,
        [PROJECT]: {
          ...createDefaultProjectState(),
          _activeSessionId: SESSION,
          _sessions: { [SESSION]: {
            ...createDefaultPerSessionState(),
            sessionProvider: codex ? 'codex' : 'claude',
            status: streaming ? 'streaming' : 'idle',
            messages: rail
              ? [
                userTurn('rail-user', 'Show the wide blocks.', '2026-10-10T00:00:00.000Z'),
                userTurn('rail-followup', 'Thanks.', '2026-10-10T00:00:01.000Z'),
                ...history,
                message,
              ]
              : [...history, message],
          } },
        },
      },
    })
    useAppStore.setState({ harnessCatalog: null })
    setReady(true)
    return () => {
      useChatStore.setState(previous)
      useAppStore.setState(app)
    }
  }, [compact, streaming, invalid, virtual, codex, rail])

  return (
    <TooltipProvider>
      <div className="flex min-w-0 flex-col gap-3" style={{ width: paneWidth, maxWidth: '100%' }}>
        <label className="flex items-center gap-3 text-xs">
          Chat pane width
          <input aria-label="Chat pane width" type="range" min={320} max={1400} step={20} value={paneWidth} onChange={event => setPaneWidth(Number(event.target.value))} />
          <span>{paneWidth}px</span>
        </label>
        <div className="@container flex h-[700px] min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
          {ready && <ChatContent scrollViewportRef={scrollRef} foreground={false} />}
        </div>
      </div>
    </TooltipProvider>
  )
}

const meta = { title: 'Chat/Markdown Width', component: MarkdownWidthPreview, parameters: { layout: 'padded' } } satisfies Meta<typeof MarkdownWidthPreview>
export default meta
type Story = StoryObj<typeof meta>

const checkWidth: NonNullable<Story['play']> = async ({ canvasElement }) => {
  await waitFor(() => {
    const pane = canvasElement.querySelector('.chat-transcript-layout') as HTMLElement
    const markdown = canvasElement.querySelector('[data-message-id="wide-markdown"] .chat-md') as HTMLElement
    const table = markdown?.querySelector('[data-streamdown="table-wrapper"]') as HTMLElement
    const mermaid = markdown?.querySelector('[data-chat-mermaid]') as HTMLElement
    expect(table).toBeInTheDocument()
    expect(mermaid).toBeInTheDocument()
    expect(mermaid.dataset.chatMermaid).not.toBe('loading')
    const bounds = pane.getBoundingClientRect()
    const column = markdown.getBoundingClientRect()
    const cap = parseFloat(getComputedStyle(pane).getPropertyValue('--container-3xl')) * parseFloat(getComputedStyle(document.documentElement).fontSize)
    expect(column.width).toBeLessThanOrEqual(cap)
    for (const block of [table, mermaid]) {
      const wide = block.getBoundingClientRect()
      expect(wide.left).toBeGreaterThanOrEqual(bounds.left - 1)
      expect(wide.right).toBeLessThanOrEqual(bounds.right + 1)
      // A block grown past the column clears the turn scroll indicator (w-7).
      if (wide.width > column.width + 1) expect(wide.right).toBeLessThanOrEqual(bounds.right - 28)
      const expanded = block === table || block.dataset.chatMermaid === 'preview'
      expect(wide.width).toBeGreaterThanOrEqual(column.width - 1)
      expect(wide.width).toBeLessThanOrEqual(column.width + (expanded ? Math.max(0, bounds.width - cap) : 0) + 1)
      if (!expanded) expect(wide.width).toBeCloseTo(column.width, 0)
      expect((wide.left + wide.right) / 2).toBeCloseTo((column.left + column.right) / 2, 0)
    }
    const viewport = pane.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  }, { timeout: 10_000 })
}

const checkExpanded: NonNullable<Story['play']> = async context => {
  await checkWidth(context)
  const markdown = context.canvasElement.querySelector('[data-message-id="wide-markdown"] .chat-md') as HTMLElement
  for (const block of markdown.querySelectorAll('[data-streamdown="table-wrapper"], [data-chat-mermaid="preview"]')) {
    expect(block.getBoundingClientRect().width).toBeGreaterThan(markdown.getBoundingClientRect().width)
  }
}

export const Wide: Story = { play: checkExpanded }
export const FitsReadingColumn: Story = {
  args: { compact: true },
  play: async context => {
    await checkWidth(context)
    const markdown = context.canvasElement.querySelector('[data-message-id="wide-markdown"] .chat-md') as HTMLElement
    for (const block of markdown.querySelectorAll('[data-streamdown="table-wrapper"], [data-chat-mermaid="preview"]')) {
      expect(block.getBoundingClientRect().width).toBeCloseTo(markdown.getBoundingClientRect().width, 0)
    }
  },
}
export const Narrow: Story = { args: { width: 390 }, play: checkWidth }

const toolbarSelector = '[data-table-toolbar], [data-chat-mermaid="preview"] [data-mermaid-toolbar]'

/** The turn rail covers the pane's right edge. Wide-block toolbars have to stay outside it. */
const checkToolbarClearsRail: NonNullable<Story['play']> = async context => {
  await checkWidth(context)
  const { canvasElement } = context
  const pane = canvasElement.querySelector('.chat-transcript-layout') as HTMLElement
  const rail = pane.parentElement?.querySelector('[data-chat-scroll-indicator]') as HTMLElement
  const markdown = canvasElement.querySelector('[data-message-id="wide-markdown"] .chat-md') as HTMLElement
  const toolbars = [...markdown.querySelectorAll<HTMLElement>(toolbarSelector)]
  expect(rail).toBeTruthy()
  expect(toolbars.length).toBeGreaterThanOrEqual(1)
  const doc = canvasElement.ownerDocument
  for (const toolbar of toolbars) {
    toolbar.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    await waitFor(() => {
      const box = toolbar.getBoundingClientRect()
      const paneBox = pane.getBoundingClientRect()
      expect(box.width).toBeGreaterThan(0)
      expect(box.top).toBeGreaterThanOrEqual(paneBox.top - 1)
      expect(box.bottom).toBeLessThanOrEqual(paneBox.bottom + 1)
      expect(box.right).toBeLessThanOrEqual(rail.getBoundingClientRect().left + 1)
      const hit = doc.elementFromPoint(box.right - 6, box.top + box.height / 2)
      expect(toolbar.contains(hit)).toBe(true)
    })
  }
}

const checkToolbarSitsOnRail: NonNullable<Story['play']> = async context => {
  await checkToolbarClearsRail(context)
  const pane = context.canvasElement.querySelector('.chat-transcript-layout') as HTMLElement
  const rail = pane.parentElement?.querySelector('[data-chat-scroll-indicator]') as HTMLElement
  const markdown = context.canvasElement.querySelector('[data-message-id="wide-markdown"] .chat-md') as HTMLElement
  const railLeft = rail.getBoundingClientRect().left
  for (const toolbar of markdown.querySelectorAll<HTMLElement>(toolbarSelector)) {
    expect(railLeft - toolbar.getBoundingClientRect().right).toBeLessThanOrEqual(2)
  }
}

export const NarrowRail: Story = { args: { width: 390, rail: true }, play: checkToolbarSitsOnRail }
// 700px is past @2xl padding but still inside the reading column, so the gutter stays zero.
export const MediumRail: Story = { args: { width: 700, rail: true }, play: checkToolbarSitsOnRail }

export const WideRail: Story = {
  args: { rail: true },
  play: async context => {
    await checkToolbarClearsRail(context)
    const markdown = context.canvasElement.querySelector('[data-message-id="wide-markdown"] .chat-md') as HTMLElement
    for (const toolbar of markdown.querySelectorAll<HTMLElement>(toolbarSelector)) {
      const block = toolbar.closest('[data-streamdown="table-wrapper"], [data-chat-mermaid="preview"]') as HTMLElement
      expect(Math.abs(toolbar.getBoundingClientRect().right - block.getBoundingClientRect().right)).toBeLessThanOrEqual(1)
    }
  },
}

export const DarkChinese: Story = { globals: { theme: 'dark', locale: 'zh' }, play: checkExpanded }
export const Streaming: Story = { args: { streaming: true }, play: checkWidth }
export const MermaidError: Story = { args: { invalid: true }, play: checkWidth }
export const VirtualHistory: Story = { args: { virtual: true }, play: checkExpanded }
export const Codex: Story = { args: { codex: true }, play: checkExpanded }

export const ResizePane: Story = {
  play: async context => {
    await checkExpanded(context)
    const slider = within(context.canvasElement).getByLabelText('Chat pane width')
    fireEvent.change(slider, { target: { value: '320' } })
    await waitFor(() => expect(context.canvasElement.querySelector('.chat-transcript-layout')!.clientWidth).toBeLessThan(400))
    await checkWidth(context)
    fireEvent.change(slider, { target: { value: '1400' } })
    await waitFor(() => expect(context.canvasElement.querySelector('.chat-transcript-layout')!.clientWidth).toBeGreaterThan(1300))
    await checkExpanded(context)
  },
}

const switchToSource: NonNullable<Story['play']> = async context => {
  const { canvasElement } = context
  await waitFor(() => expect(canvasElement.querySelector('[data-chat-mermaid="preview"] svg[id]')).toBeInTheDocument())
  const preview = canvasElement.querySelector('[data-chat-mermaid="preview"]') as HTMLElement
  expect(getComputedStyle(preview).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(within(preview).queryByText('Mermaid', { exact: true })).toBeNull()
  await userEvent.click(within(preview).getByRole('button', { name: 'Source' }))
  await waitFor(() => {
    const source = canvasElement.querySelector('[data-chat-mermaid="source"]') as HTMLElement
    expect(within(source).getByText('Mermaid', { exact: true })).toBeInTheDocument()
    expect(source.querySelector('pre')).toBeInTheDocument()
    expect(getComputedStyle(source).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })
  await checkWidth(context)
}

export const SourceMode: Story = { play: switchToSource }
export const ToggleModes: Story = {
  play: async context => {
    await switchToSource(context)
    const source = context.canvasElement.querySelector('[data-chat-mermaid="source"]') as HTMLElement
    await userEvent.click(within(source).getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(context.canvasElement.querySelector('[data-chat-mermaid="preview"] svg[id]')).toBeInTheDocument())
    await checkWidth(context)
  },
}

const checkModeTransition: NonNullable<Story['play']> = async context => {
  await checkWidth(context)
  for (const [from, to, label] of [['preview', 'source', 'Source'], ['source', 'preview', 'Preview']] as const) {
    const samples: { mode: string; opacity: number }[] = []
    const counts: number[] = []
    let frame = 0
    const sample = () => {
      const blocks = context.canvasElement.querySelectorAll<HTMLElement>('[data-chat-mermaid]')
      counts.push(blocks.length)
      for (const block of blocks) samples.push({ mode: block.dataset.chatMermaid!, opacity: Number(getComputedStyle(block).opacity) })
      frame = requestAnimationFrame(sample)
    }
    sample()
    try {
      const current = context.canvasElement.querySelector(`[data-chat-mermaid="${from}"]`) as HTMLElement
      await userEvent.click(within(current).getByRole('button', { name: label }))
      await waitFor(() => {
        const next = context.canvasElement.querySelector(`[data-chat-mermaid="${to}"]`) as HTMLElement
        expect(next).toBeInTheDocument()
        expect(Number(getComputedStyle(next).opacity)).toBe(1)
        expect(within(next).getByRole('button', { name: to === 'source' ? 'Preview' : 'Source' })).toHaveFocus()
      })
    } finally {
      cancelAnimationFrame(frame)
    }
    expect(counts.every(count => count === 1)).toBe(true)
    for (const mode of [from, to]) expect(samples.some(sample => sample.mode === mode && sample.opacity > 0 && sample.opacity < 1)).toBe(true)
    await checkWidth(context)
  }
}

export const ModeTransition: Story = { play: checkModeTransition }
export const NarrowModeTransition: Story = {
  args: { width: 390 },
  play: checkModeTransition,
}
export const DarkModeTransition: Story = { globals: { theme: 'dark' }, play: checkModeTransition }
export const RapidModeToggle: Story = {
  play: async context => {
    await checkWidth(context)
    const preview = context.canvasElement.querySelector('[data-chat-mermaid="preview"]') as HTMLElement
    await userEvent.dblClick(within(preview).getByRole('button', { name: 'Source' }))
    await waitFor(() => {
      const current = context.canvasElement.querySelector('[data-chat-mermaid="preview"]') as HTMLElement
      expect(current?.querySelector('svg[id]')).toBeInTheDocument()
      expect(Number(getComputedStyle(current).opacity)).toBe(1)
      expect(context.canvasElement.querySelector('[data-chat-mermaid="source"]')).toBeNull()
    })
    await checkWidth(context)
  },
}

async function withClipboardWrite(write: (items: ClipboardItem[]) => Promise<void>, run: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(navigator.clipboard, 'write')
  Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: write })
  try {
    await run()
  } finally {
    if (descriptor) Object.defineProperty(navigator.clipboard, 'write', descriptor)
    else Reflect.deleteProperty(navigator.clipboard, 'write')
  }
}

export const CopyImage: Story = {
  args: { compact: true },
  play: async context => {
    await checkWidth(context)
    const preview = context.canvasElement.querySelector('[data-chat-mermaid="preview"]') as HTMLElement
    expect(within(preview).getByRole('button', { name: 'Copy Code' })).toBeInTheDocument()
    let png: Blob | undefined
    await withClipboardWrite(async items => { png = await items[0].getType('image/png') }, async () => {
      const button = within(preview).getByRole('button', { name: 'Copy Image' })
      await userEvent.click(button)
      await waitFor(() => {
        expect(png?.type).toBe('image/png')
        expect(png?.size).toBeGreaterThan(1000)
        expect(button.querySelector('.lucide-check')).toBeInTheDocument()
      })
      const bitmap = await createImageBitmap(png!)
      const svg = preview.querySelector('svg[id]') as SVGSVGElement
      expect(bitmap.width).toBeCloseTo(svg.viewBox.baseVal.width, 0)
      expect(bitmap.height).toBeCloseTo(svg.viewBox.baseVal.height, 0)
      bitmap.close()
    })
  },
}

export const CopyImageDenied: Story = {
  args: { compact: true },
  play: async context => {
    await checkWidth(context)
    const preview = context.canvasElement.querySelector('[data-chat-mermaid="preview"]') as HTMLElement
    await withClipboardWrite(async () => { throw new DOMException('Clipboard permission denied', 'NotAllowedError') }, async () => {
      const button = within(preview).getByRole('button', { name: 'Copy Image' })
      await userEvent.click(button)
      expect(button.querySelector('.lucide-check')).toBeNull()
      expect(button.querySelector('.lucide-image')).toBeInTheDocument()
    })
  },
}

export const FullscreenZoom: Story = {
  play: async context => {
    await checkWidth(context)
    const preview = context.canvasElement.querySelector('[data-chat-mermaid="preview"]') as HTMLElement
    await userEvent.click(within(preview).getByRole('button', { name: 'Expand' }))
    const dialog = await within(document.body).findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText('100%')).toBeInTheDocument())
    await waitFor(() => {
      const viewport = dialog.querySelector('.pointer-events-none.absolute.border-2') as HTMLElement
      expect(parseFloat(viewport.style.width)).toBeGreaterThan(0)
    })
    await userEvent.keyboard('{-}{-}{-}{-}{-}{-}')
    await waitFor(() => expect(within(dialog).getByText('25%')).toBeInTheDocument())
    await userEvent.keyboard('{+}'.repeat(20))
    await waitFor(() => expect(within(dialog).getByText('300%')).toBeInTheDocument())
    await userEvent.keyboard('0')
    await waitFor(() => expect(within(dialog).getByText('100%')).toBeInTheDocument())
    dialog.focus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  },
}
