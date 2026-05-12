"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { ScrollArea } from "@superone/ui/components/ui/scroll-area"
import { cn } from "@superone/ui/lib/utils"
import { DesktopShell, type DesktopShellProps } from "./desktop-shell"
import { ChatInputMock } from "./chat-input-mock"
import type { Harness } from "./icons"

export type MockMessageRole = "user" | "assistant"

export type MockBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "code"; language?: string; code: string }
  | { type: "quote"; text: string }

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
      { type: "paragraph", text: "Sure. Here's the plan I'd take, scoped to AppSidebar.tsx:" },
      {
        type: "list",
        ordered: true,
        items: [
          "Replace the boolean expansion state with a `Set<string>` keyed by `folderPath`.",
          "Wire the chevron's `onClick` to toggle that set; leave the row body's `onClick` for selecting the project.",
          "Persist nothing for now — we'll see the in-memory behavior first, then decide on localStorage.",
        ],
      },
      { type: "paragraph", text: "Sketch of the state hook:" },
      {
        type: "code",
        language: "ts",
        code: `const [expanded, setExpanded] = useState(() => new Set<string>())\nconst toggle = useCallback((path: string) => {\n  setExpanded((prev) => {\n    const next = new Set(prev)\n    next.has(path) ? next.delete(path) : next.add(path)\n    return next\n  })\n}, [])`,
      },
      { type: "paragraph", text: "Want me to draft the full diff against the current `AppSidebar.tsx`?" },
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
      { type: "heading", level: 3, text: "Keyboard shortcut" },
      {
        type: "paragraph",
        text:
          "I'll register a global `keydown` listener mirroring the existing tab switcher pattern. It calls `toggle(currentFolder)` when the modifier combo fires.",
      },
      { type: "heading", level: 3, text: "Trade-offs" },
      {
        type: "list",
        items: [
          "Keyboard handler lives at the `AppSidebar` level (not document-level) so it only fires while the sidebar is mounted.",
          "Doesn't fight with input focus — we explicitly bail if `e.target` is in an editable element.",
        ],
      },
      {
        type: "quote",
        text:
          "If this turns out to feel sluggish on long lists, we can switch to `requestAnimationFrame` batching, but it's not needed for the current size.",
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
        type: "code",
        language: "diff",
        code: `- const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())\n+ const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())\n\n  const toggleExpand = useCallback((folderPath: string) => {\n-   setExpandedFolders((prev) => {\n-     const next = new Set(prev)\n-     if (next.has(folderPath)) { next.delete(folderPath) }\n-     else { next.add(folderPath); willExpand = true }\n-     return next\n-   })\n+   setExpandedFolders((prev) => {\n+     const next = new Set(prev)\n+     next.has(folderPath) ? next.delete(folderPath) : next.add(folderPath)\n+     return next\n+   })\n+   if (!folderSessionsRef.current[folderPath]) {\n+     void loadFolderSessions(folderPath, 'expand')\n+   }\n  }, [loadFolderSessions])`,
      },
      { type: "paragraph", text: "Compact, no behavior regression — and the chevron click now stays scoped to expansion only." },
    ],
  },
]

export function ChatMock({
  title = "Refactor sidebar layout",
  messages = DEFAULT_MESSAGES,
  placeholder,
  autoScroll = false,
  harness = "claude",
  ...shellProps
}: ChatMockProps) {
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!autoScroll) return
    const v = viewportRef.current
    if (!v) return
    v.scrollTo({ top: v.scrollHeight, behavior: "smooth" })
  }, [autoScroll, messages])

  return (
    <DesktopShell headerTitle={title} {...shellProps}>
      <div className="flex h-full flex-col">
        <ScrollArea className="flex-1 min-h-0" viewportRef={viewportRef}>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-3.5">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        </ScrollArea>
        <ChatInputMock harness={harness} placeholder={placeholder} contextPct={0.32} />
      </div>
    </DesktopShell>
  )
}

function MessageBubble({ message }: { message: MockMessage }) {
  const isUser = message.role === "user"
  const blocks = message.blocks ?? (message.text ? [{ type: "paragraph" as const, text: message.text }] : [])

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "mb-2 justify-start")}>
      <div className={cn(isUser ? "flex max-w-[85%] flex-col items-end" : "w-full")}>
        <div
          className={cn(
            "min-w-0 text-sm",
            isUser
              ? "max-w-full overflow-hidden rounded-xl bg-secondary px-3 py-2 text-secondary-foreground break-words"
              : "w-full text-foreground",
          )}
        >
          {blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} isUser={isUser} />
          ))}
        </div>
      </div>
    </div>
  )
}

function BlockRenderer({ block, isUser }: { block: MockBlock; isUser: boolean }) {
  switch (block.type) {
    case "paragraph":
      return <p className={cn("leading-relaxed", isUser ? "" : "my-2 first:mt-0 last:mb-0")}>{inlineMd(block.text)}</p>
    case "heading": {
      const cls =
        block.level === 1
          ? "mt-4 mb-2 text-base font-semibold"
          : block.level === 2
            ? "mt-3 mb-1.5 text-[15px] font-semibold"
            : "mt-2.5 mb-1 text-sm font-semibold"
      return <div className={cls}>{block.text}</div>
    }
    case "list": {
      const Tag = block.ordered ? "ol" : "ul"
      return (
        <Tag
          className={cn(
            "my-2 space-y-1 leading-relaxed",
            block.ordered ? "list-decimal pl-5" : "list-disc pl-5",
          )}
        >
          {block.items.map((item, i) => (
            <li key={i}>{inlineMd(item)}</li>
          ))}
        </Tag>
      )
    }
    case "code":
      return <CodeMockBlock language={block.language} code={block.code} />
    case "quote":
      return (
        <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground leading-relaxed">
          {inlineMd(block.text)}
        </blockquote>
      )
  }
}

function CodeMockBlock({ language, code }: { language?: string; code: string }) {
  return (
    <div className="my-2 overflow-hidden rounded-md bg-[#1f2428] text-[#e1e4e8]">
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] opacity-60">
        <span>{language ?? "text"}</span>
        <span className="text-[10px]">copy</span>
      </div>
      <pre className="overflow-x-auto px-3 pb-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g

function inlineMd(text: string): ReactNode {
  const parts = text.split(INLINE_RE)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 text-[12px] text-foreground">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      )
    }
    return <span key={i}>{part}</span>
  })
}
