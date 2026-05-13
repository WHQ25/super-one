"use client"

import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { ScrollArea } from "@superone/ui/components/ui/scroll-area"
import { cn } from "@superone/ui/lib/utils"
import { ArrowDown, ArrowUp, Clock, Loader2 } from "lucide-react"
import { DesktopShell, type DesktopShellProps } from "./desktop-shell"
import { ChatInputMock } from "./chat-input-mock"
import type { Harness } from "./icons"
import { ToolBlockMock, type ToolBlockSpec } from "./tool-block-mock"
import { MockMarkdown } from "./mock-markdown"
import { ReasoningBlock } from "./chat-md/ReasoningBlock"

export type MockMessageRole = "user" | "assistant"

export type MockBlock =
  | { type: "markdown"; text: string; isStreaming?: boolean }
  | { type: "thinking"; text: string; done?: boolean }
  | {
      type: "tool"
      spec: ToolBlockSpec
      isStreaming?: boolean
      expanded?: boolean
      cost?: number
    }
  | { type: "custom"; node: ReactNode; cost?: number }

const TOOL_DEFAULT_COST = 80

export interface MockMessage {
  id: string
  role: MockMessageRole
  text?: string
  blocks?: MockBlock[]
}

export interface ChatMockProps extends Omit<DesktopShellProps, "children" | "headerTitle"> {
  title?: string
  messages?: MockMessage[]
  placeholder?: string
  autoScroll?: boolean
  harness?: Harness
  frame?: number
  fps?: number
  typingCps?: number
  userPauseMs?: number
  assistantPauseMs?: number
  showCaret?: boolean
  permissionPrompt?: ReactNode
  askUserQuestion?: ReactNode
  todoPopup?: ReactNode
  planApproval?: ReactNode
  showFooter?: boolean
}

interface FooterMeta {
  kind: "streaming" | "done"
  durationMs: number
  inputTokens: number
  outputTokens: number
  inputFlashOn: boolean
  outputFlashOn: boolean
}

const FOOTER_INPUT_BASELINE = 2000
const FOOTER_CHARS_PER_TOKEN = 4
const FOOTER_INPUT_FLASH_MS = 800

function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const DEFAULT_MESSAGES: MockMessage[] = [
  {
    id: "m1",
    role: "user",
    text: "Help me refactor the sidebar so the project rows can collapse independently.",
  },
  {
    id: "m2",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: `Sure. Here's the plan I'd take, scoped to \`AppSidebar.tsx\`:

1. Replace the boolean expansion state with a \`Set<string>\` keyed by \`folderPath\`.
2. Wire the chevron's \`onClick\` to toggle that set; leave the row body's \`onClick\` for selecting the project.
3. Persist nothing for now — we'll see the in-memory behavior first, then decide on localStorage.

Sketch of the state hook:

\`\`\`ts
const [expanded, setExpanded] = useState(() => new Set<string>())
const toggle = useCallback((path: string) => {
  setExpanded((prev) => {
    const next = new Set(prev)
    next.has(path) ? next.delete(path) : next.add(path)
    return next
  })
}, [])
\`\`\`

Want me to draft the full diff against the current \`AppSidebar.tsx\`?`,
      },
    ],
  },
  {
    id: "m3",
    role: "user",
    text: "Yes, please. Also wire Cmd+Shift+[ to collapse the currently active project.",
  },
  {
    id: "m4",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: `### Keyboard shortcut

I'll register a global \`keydown\` listener mirroring the existing tab switcher pattern. It calls \`toggle(currentFolder)\` when the modifier combo fires.

### Trade-offs

- Keyboard handler lives at the \`AppSidebar\` level (not document-level) so it only fires while the sidebar is mounted.
- Doesn't fight with input focus — we explicitly bail if \`e.target\` is in an editable element.

> If this turns out to feel sluggish on long lists, we can switch to \`requestAnimationFrame\` batching, but it's not needed for the current size.`,
      },
    ],
  },
  {
    id: "m5",
    role: "user",
    text: "Sounds good. Show me the diff.",
  },
  {
    id: "m6",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: `\`\`\`diff
- const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
+ const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())

  const toggleExpand = useCallback((folderPath: string) => {
-   setExpandedFolders((prev) => {
-     const next = new Set(prev)
-     if (next.has(folderPath)) { next.delete(folderPath) }
-     else { next.add(folderPath); willExpand = true }
-     return next
-   })
+   setExpandedFolders((prev) => {
+     const next = new Set(prev)
+     next.has(folderPath) ? next.delete(folderPath) : next.add(folderPath)
+     return next
+   })
+   if (!folderSessionsRef.current[folderPath]) {
+     void loadFolderSessions(folderPath, 'expand')
+   }
  }, [loadFolderSessions])
\`\`\`

Compact, no behavior regression — and the chevron click now stays scoped to expansion only.`,
      },
    ],
  },
]

interface RevealState {
  visible: MockMessage[]
  streamingId: string | null
  streamingBlockStartMs: number | null
  streamingBlockDurationMs: number | null
  footerMeta: Map<string, FooterMeta>
}

function blockTextLength(block: MockBlock): number {
  switch (block.type) {
    case "markdown":
      return block.text.length
    case "thinking":
      return block.text.length
    case "tool":
      return block.cost ?? TOOL_DEFAULT_COST
    case "custom":
      return block.cost ?? TOOL_DEFAULT_COST
  }
}

function truncateBlock(block: MockBlock, chars: number): MockBlock {
  switch (block.type) {
    case "markdown":
      return { ...block, text: block.text.slice(0, chars), isStreaming: true }
    case "thinking":
      return { ...block, text: block.text.slice(0, chars) }
    case "tool":
      return { ...block, isStreaming: true }
    case "custom":
      return block
  }
}

function messageTextLength(msg: MockMessage): number {
  if (msg.blocks && msg.blocks.length > 0) {
    return msg.blocks.reduce((sum, b) => sum + blockTextLength(b), 0)
  }
  return msg.text?.length ?? 0
}

function revealMessage(
  msg: MockMessage,
  chars: number,
  cps: number,
  messageStartMs: number,
): { msg: MockMessage; streamingBlockStartMs: number | null; streamingBlockDurationMs: number | null } {
  if (msg.blocks && msg.blocks.length > 0) {
    const out: MockBlock[] = []
    let remaining = chars
    let consumedMs = messageStartMs
    let streamingBlockStartMs: number | null = null
    let streamingBlockDurationMs: number | null = null
    for (const b of msg.blocks) {
      if (remaining <= 0) break
      const len = blockTextLength(b)
      if (remaining >= len) {
        out.push(b)
        remaining -= len
        consumedMs += (len / cps) * 1000
      } else {
        streamingBlockStartMs = consumedMs
        streamingBlockDurationMs = (len / cps) * 1000
        out.push(truncateBlock(b, remaining))
        remaining = 0
      }
    }
    return { msg: { ...msg, blocks: out }, streamingBlockStartMs, streamingBlockDurationMs }
  }
  if (msg.text) {
    return {
      msg: { ...msg, text: msg.text.slice(0, chars) },
      streamingBlockStartMs: null,
      streamingBlockDurationMs: null,
    }
  }
  return { msg, streamingBlockStartMs: null, streamingBlockDurationMs: null }
}

function computeReveal(
  messages: MockMessage[],
  currentMs: number,
  opts: { typingCps: number; userPauseMs: number; assistantPauseMs: number },
): RevealState {
  const visible: MockMessage[] = []
  const footerMeta = new Map<string, FooterMeta>()
  let streamingId: string | null = null
  let streamingBlockStartMs: number | null = null
  let streamingBlockDurationMs: number | null = null
  let t = 0
  let priorChars = 0
  for (const msg of messages) {
    if (msg.role === "user") {
      t += opts.userPauseMs
      if (currentMs < t) break
      visible.push(msg)
      priorChars += msg.text?.length ?? 0
    } else {
      t += opts.assistantPauseMs
      const total = messageTextLength(msg)
      const durationMs = total === 0 ? 0 : (total / opts.typingCps) * 1000
      const startMs = t
      const endMs = t + durationMs
      if (currentMs < startMs) break
      const baseInput = FOOTER_INPUT_BASELINE + Math.floor(priorChars / FOOTER_CHARS_PER_TOKEN)
      if (currentMs >= endMs || durationMs === 0) {
        visible.push(msg)
        footerMeta.set(msg.id, {
          kind: "done",
          durationMs,
          inputTokens: baseInput,
          outputTokens: Math.floor(total / FOOTER_CHARS_PER_TOKEN),
          inputFlashOn: false,
          outputFlashOn: false,
        })
        priorChars += total
        t = endMs
        continue
      }
      const elapsedMs = currentMs - startMs
      const ratio = elapsedMs / durationMs
      const chars = Math.max(1, Math.floor(total * ratio))
      const reveal = revealMessage(msg, chars, opts.typingCps, startMs)
      visible.push(reveal.msg)
      streamingId = msg.id
      streamingBlockStartMs = reveal.streamingBlockStartMs
      streamingBlockDurationMs = reveal.streamingBlockDurationMs
      footerMeta.set(msg.id, {
        kind: "streaming",
        durationMs: elapsedMs,
        inputTokens: baseInput,
        outputTokens: Math.floor(chars / FOOTER_CHARS_PER_TOKEN),
        inputFlashOn: elapsedMs < FOOTER_INPUT_FLASH_MS,
        outputFlashOn: chars > 0,
      })
      break
    }
  }
  return { visible, streamingId, streamingBlockStartMs, streamingBlockDurationMs, footerMeta }
}

function buildStaticFooterMeta(messages: MockMessage[], typingCps: number): Map<string, FooterMeta> {
  const meta = new Map<string, FooterMeta>()
  let priorChars = 0
  for (const msg of messages) {
    if (msg.role === "user") {
      priorChars += msg.text?.length ?? 0
      continue
    }
    const total = messageTextLength(msg)
    meta.set(msg.id, {
      kind: "done",
      durationMs: total === 0 ? 0 : (total / typingCps) * 1000,
      inputTokens: FOOTER_INPUT_BASELINE + Math.floor(priorChars / FOOTER_CHARS_PER_TOKEN),
      outputTokens: Math.floor(total / FOOTER_CHARS_PER_TOKEN),
      inputFlashOn: false,
      outputFlashOn: false,
    })
    priorChars += total
  }
  return meta
}

export function ChatMock({
  title = "Refactor sidebar layout",
  messages = DEFAULT_MESSAGES,
  placeholder,
  autoScroll = false,
  harness = "claude",
  frame,
  fps = 30,
  typingCps = 80,
  userPauseMs = 700,
  assistantPauseMs = 350,
  showCaret = true,
  permissionPrompt,
  askUserQuestion,
  todoPopup,
  planApproval,
  showFooter = true,
  ...shellProps
}: ChatMockProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const isFrameDriven = frame !== undefined

  const reveal = useMemo<RevealState>(() => {
    if (!isFrameDriven)
      return {
        visible: messages,
        streamingId: null,
        streamingBlockStartMs: null,
        streamingBlockDurationMs: null,
        footerMeta: buildStaticFooterMeta(messages, typingCps),
      }
    const currentMs = (frame! / fps) * 1000
    return computeReveal(messages, currentMs, { typingCps, userPauseMs, assistantPauseMs })
  }, [isFrameDriven, frame, fps, messages, typingCps, userPauseMs, assistantPauseMs])

  const streamingBlockStartFrame =
    isFrameDriven && reveal.streamingBlockStartMs !== null
      ? Math.round((reveal.streamingBlockStartMs / 1000) * fps)
      : undefined
  const streamingBlockDurationFrames =
    isFrameDriven && reveal.streamingBlockDurationMs !== null
      ? Math.max(1, Math.round((reveal.streamingBlockDurationMs / 1000) * fps))
      : undefined

  const caretOn = isFrameDriven && showCaret && Math.floor((frame! / fps) * 2) % 2 === 0

  useEffect(() => {
    const shouldScroll = autoScroll || isFrameDriven
    if (!shouldScroll) return
    const v = viewportRef.current
    if (!v) return
    v.scrollTo({ top: v.scrollHeight, behavior: isFrameDriven ? "auto" : "smooth" })
  }, [autoScroll, isFrameDriven, reveal])

  return (
    <DesktopShell headerTitle={title} {...shellProps}>
      <ChatBodyInner
        reveal={reveal}
        viewportRef={viewportRef}
        caretOn={caretOn}
        frame={frame}
        fps={fps}
        streamingBlockStartFrame={streamingBlockStartFrame}
        streamingBlockDurationFrames={streamingBlockDurationFrames}
        showFooter={showFooter}
        harness={harness}
        placeholder={placeholder}
        permissionPrompt={permissionPrompt}
        askUserQuestion={askUserQuestion}
        todoPopup={todoPopup}
        planApproval={planApproval}
      />
    </DesktopShell>
  )
}

export interface ChatBodyProps {
  messages?: MockMessage[]
  placeholder?: string
  autoScroll?: boolean
  harness?: Harness
  frame?: number
  fps?: number
  typingCps?: number
  userPauseMs?: number
  assistantPauseMs?: number
  showCaret?: boolean
  permissionPrompt?: ReactNode
  askUserQuestion?: ReactNode
  todoPopup?: ReactNode
  planApproval?: ReactNode
  showFooter?: boolean
}

export function ChatBody({
  messages = DEFAULT_MESSAGES,
  placeholder,
  autoScroll = false,
  harness = "claude",
  frame,
  fps = 30,
  typingCps = 80,
  userPauseMs = 700,
  assistantPauseMs = 350,
  showCaret = true,
  permissionPrompt,
  askUserQuestion,
  todoPopup,
  planApproval,
  showFooter = true,
}: ChatBodyProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const isFrameDriven = frame !== undefined

  const reveal = useMemo<RevealState>(() => {
    if (!isFrameDriven)
      return {
        visible: messages,
        streamingId: null,
        streamingBlockStartMs: null,
        streamingBlockDurationMs: null,
        footerMeta: buildStaticFooterMeta(messages, typingCps),
      }
    const currentMs = (frame! / fps) * 1000
    return computeReveal(messages, currentMs, { typingCps, userPauseMs, assistantPauseMs })
  }, [isFrameDriven, frame, fps, messages, typingCps, userPauseMs, assistantPauseMs])

  const streamingBlockStartFrame =
    isFrameDriven && reveal.streamingBlockStartMs !== null
      ? Math.round((reveal.streamingBlockStartMs / 1000) * fps)
      : undefined
  const streamingBlockDurationFrames =
    isFrameDriven && reveal.streamingBlockDurationMs !== null
      ? Math.max(1, Math.round((reveal.streamingBlockDurationMs / 1000) * fps))
      : undefined

  const caretOn = isFrameDriven && showCaret && Math.floor((frame! / fps) * 2) % 2 === 0

  useEffect(() => {
    const shouldScroll = autoScroll || isFrameDriven
    if (!shouldScroll) return
    const v = viewportRef.current
    if (!v) return
    v.scrollTo({ top: v.scrollHeight, behavior: isFrameDriven ? "auto" : "smooth" })
  }, [autoScroll, isFrameDriven, reveal])

  return (
    <ChatBodyInner
      reveal={reveal}
      viewportRef={viewportRef}
      caretOn={caretOn}
      frame={frame}
      fps={fps}
      streamingBlockStartFrame={streamingBlockStartFrame}
      streamingBlockDurationFrames={streamingBlockDurationFrames}
      showFooter={showFooter}
      harness={harness}
      placeholder={placeholder}
      permissionPrompt={permissionPrompt}
      askUserQuestion={askUserQuestion}
      todoPopup={todoPopup}
      planApproval={planApproval}
    />
  )
}

function ChatBodyInner({
  reveal,
  viewportRef,
  caretOn,
  frame,
  fps,
  streamingBlockStartFrame,
  streamingBlockDurationFrames,
  showFooter,
  harness,
  placeholder,
  permissionPrompt,
  askUserQuestion,
  todoPopup,
  planApproval,
}: {
  reveal: RevealState
  viewportRef: React.RefObject<HTMLDivElement | null>
  caretOn: boolean
  frame: number | undefined
  fps: number
  streamingBlockStartFrame: number | undefined
  streamingBlockDurationFrames: number | undefined
  showFooter: boolean
  harness: Harness
  placeholder?: string
  permissionPrompt?: ReactNode
  askUserQuestion?: ReactNode
  todoPopup?: ReactNode
  planApproval?: ReactNode
}) {
  return (
    <div className="@container flex h-full flex-col">
      {planApproval ? (
        planApproval
      ) : (
        <>
          <div className="relative flex-1 min-h-0">
            <ScrollArea className="h-full" viewportRef={viewportRef}>
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-3.5">
                {reveal.visible.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    streaming={reveal.streamingId === msg.id}
                    caretOn={caretOn}
                    frame={frame}
                    fps={fps}
                    streamStartFrame={
                      reveal.streamingId === msg.id ? streamingBlockStartFrame : undefined
                    }
                    streamDurationFrames={
                      reveal.streamingId === msg.id ? streamingBlockDurationFrames : undefined
                    }
                    footerMeta={showFooter ? reveal.footerMeta.get(msg.id) : undefined}
                  />
                ))}
              </div>
            </ScrollArea>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-linear-to-t from-card to-transparent" />
          </div>
          <div className="mx-auto w-full min-w-0 max-w-3xl">
            {permissionPrompt}
            {askUserQuestion}
            {todoPopup}
            <ChatInputMock harness={harness} placeholder={placeholder} contextPct={0.32} />
          </div>
        </>
      )}
    </div>
  )
}

function MessageBubble({
  message,
  streaming = false,
  caretOn = false,
  frame,
  fps,
  streamStartFrame,
  streamDurationFrames,
  footerMeta,
}: {
  message: MockMessage
  streaming?: boolean
  caretOn?: boolean
  frame?: number
  fps?: number
  streamStartFrame?: number
  streamDurationFrames?: number
  footerMeta?: FooterMeta
}) {
  const isUser = message.role === "user"
  const blocks: MockBlock[] =
    message.blocks ?? (message.text ? [{ type: "markdown" as const, text: message.text }] : [])

  return (
    <div className={cn("w-0 min-w-full flex", isUser ? "justify-end" : "mb-2 justify-start")}>
      <div
        className={cn(
          isUser
            ? "group/copy relative mb-0 flex min-w-0 max-w-[90%] flex-col items-end"
            : "w-full",
        )}
      >
        <div
          className={cn(
            "min-w-0 text-sm",
            isUser
              ? "max-w-full overflow-hidden rounded-xl bg-secondary px-3 py-2 text-secondary-foreground break-all"
              : "assistant-reply w-full text-foreground",
          )}
        >
          {isUser ? (
            <p className="leading-relaxed">{message.text}</p>
          ) : (
            <>
              {blocks.map((block, i) => {
                const isLast = i === blocks.length - 1
                const isStreamingBlock = streaming && isLast
                return (
                  <BlockRenderer
                    key={i}
                    block={block}
                    streaming={isStreamingBlock}
                    caretOn={caretOn}
                    frame={frame}
                    fps={fps}
                    isFirst={i === 0}
                    prevBlockType={i > 0 ? blocks[i - 1].type : undefined}
                    streamStartFrame={isStreamingBlock ? streamStartFrame : undefined}
                    streamDurationFrames={isStreamingBlock ? streamDurationFrames : undefined}
                  />
                )
              })}
              {footerMeta ? <MessageFooter meta={footerMeta} /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageFooter({ meta }: { meta: FooterMeta }) {
  const isStreaming = meta.kind === "streaming"
  const seconds = Math.max(0, Math.round(meta.durationMs / 1000))
  const display = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hasTokens = meta.inputTokens > 0 || meta.outputTokens > 0

  return (
    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors duration-500">
      {isStreaming ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Clock className="size-3" />
      )}
      <span>{display}</span>
      {hasTokens ? (
        <>
          <span>·</span>
          {meta.inputTokens > 0 ? (
            <AnimatedTokenMock
              value={meta.inputTokens}
              direction="up"
              flash={meta.inputFlashOn}
            />
          ) : null}
          {meta.outputTokens > 0 ? (
            <AnimatedTokenMock
              value={meta.outputTokens}
              direction="down"
              flash={meta.outputFlashOn}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function AnimatedTokenMock({
  value,
  direction,
  flash,
}: {
  value: number
  direction: "up" | "down"
  flash: boolean
}) {
  const isUp = direction === "up"
  const flashColor = isUp ? "text-blue-600 dark:text-blue-400" : "text-emerald-400"
  const Arrow = isUp ? ArrowUp : ArrowDown
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 tabular-nums transition-colors duration-500",
        flash && flashColor,
      )}
    >
      <Arrow
        className={cn(
          "size-3 transition-transform duration-300",
          flash && "scale-110",
        )}
      />
      <span>{formatTokens(value)}</span>
    </span>
  )
}

function BlockRenderer({
  block,
  streaming = false,
  frame,
  fps,
  isFirst = false,
  prevBlockType,
  streamStartFrame,
  streamDurationFrames,
}: {
  block: MockBlock
  streaming?: boolean
  caretOn?: boolean
  frame?: number
  fps?: number
  isFirst?: boolean
  prevBlockType?: MockBlock["type"]
  streamStartFrame?: number
  streamDurationFrames?: number
}) {
  switch (block.type) {
    case "markdown": {
      const md = <MockMarkdown text={block.text} isStreaming={block.isStreaming ?? streaming} />
      return prevBlockType === "thinking" ? <div className="mt-1 after-thinking">{md}</div> : md
    }
    case "tool":
      return (
        <ToolBlockMock
          spec={block.spec}
          isStreaming={block.isStreaming}
          defaultExpanded={block.expanded ?? false}
          frame={frame}
          fps={fps}
          streamStartFrame={block.isStreaming ? streamStartFrame : undefined}
          streamDurationFrames={block.isStreaming ? streamDurationFrames : undefined}
          className="my-1.5"
        />
      )
    case "thinking":
      return (
        <ReasoningBlock
          text={block.text}
          blockDone={block.done ?? !streaming}
          isFirst={isFirst}
          frame={frame}
          fps={fps}
        />
      )
    case "custom":
      return <>{block.node}</>
  }
}
