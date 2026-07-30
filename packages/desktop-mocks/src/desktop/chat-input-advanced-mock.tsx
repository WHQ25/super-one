"use client"

import type { CSSProperties, ReactNode } from "react"
import {
  ArrowUp,
  Bot,
  ChevronDown,
  Check,
  Circle,
  FileText,
  Folder,
  FolderClosed,
  GitBranch,
  Paperclip,
  Quote,
  Shield,
  Square,
  UnfoldVertical,
  X,
} from "lucide-react"
import { FileIcon } from "@superone/ui/components/ui/FileIcon"
import { Kbd } from "@superone/ui/components/ui/kbd"
import { cn } from "@superone/ui/lib/utils"
import type { Harness } from "./icons"
import { useMockT } from "./i18n"

export type ChatInputDirScope = "user" | "project" | "session"

export interface ChatInputDirHintMock {
  name: string
  scope: ChatInputDirScope
}

export type MentionChipKind = "file" | "directory" | "agent"

export interface MentionChipMock {
  kind: MentionChipKind
  displayName: string
}

export interface PasteChipMock {
  preview: string
  lineCount: number
  selected?: boolean
}

export type ImageThumbnailKind =
  | { kind: "screenshot"; hueA: number; hueB: number }
  | { kind: "photo"; hueA: number; hueB: number }
  | { kind: "diagram"; accent: number }
  | { kind: "code"; accent: number }

export interface ImageAttachmentMock {
  type: "image"
  name: string
  thumbnail: ImageThumbnailKind
}

export interface PdfAttachmentMock {
  type: "pdf"
  name: string
  pages?: number
}

export type AttachmentMock = ImageAttachmentMock | PdfAttachmentMock

export interface MiniAppContextChipMock {
  appId: string
  appName: string
  summary?: string
  color: string
  mode: "always" | "suggest"
  checked?: boolean
  monogram?: string
}

export interface UserSelectionChipMock {
  filePath?: string
  rangeText?: string
  preview?: string
  count?: number
}

export interface MentionPopupItemMock {
  kind: MentionChipKind
  name: string
  subtitle?: string
  matchIndices?: number[]
}

export interface MentionPopupMock {
  query: string
  breadcrumbs?: string[]
  items: MentionPopupItemMock[]
  activeIndex?: number
}

export interface SlashCommandSuggestionMock {
  name: string
  description?: string
  argumentHint?: string
  isSkill?: boolean
  matchIndices?: number[]
}

export interface SlashPopupMock {
  query: string
  commands: SlashCommandSuggestionMock[]
  activeIndex?: number
}

export interface ChatInputAdvancedMockProps {
  harness?: Harness
  workDirName?: string
  branch?: string
  branchDirty?: boolean
  permissionLabel?: string
  sandboxLabel?: "Off" | "On" | "Auto"
  modelLabel?: string
  effortLabel?: string
  contextPct?: number

  placeholder?: string
  value?: string
  caretAtEnd?: boolean
  caretOn?: boolean
  promptSuggestion?: string

  mentions?: MentionChipMock[]
  pasteChips?: PasteChipMock[]
  attachments?: AttachmentMock[]
  miniAppContexts?: MiniAppContextChipMock[]
  userSelections?: UserSelectionChipMock[]

  isDragging?: boolean
  additionalDirs?: ChatInputDirHintMock[]
  mentionPopup?: MentionPopupMock
  slashPopup?: SlashPopupMock

  className?: string
  overlay?: ReactNode
}

const DEFAULT_MODEL: Record<Harness, string> = {
  claude: "Opus 4.7 1M",
  codex: "GPT-5.5",
}

export function ChatInputAdvancedMock({
  harness = "claude",
  workDirName = "super-one",
  branch = "main",
  branchDirty = true,
  permissionLabel = "Normal",
  sandboxLabel = "On",
  modelLabel,
  effortLabel,
  contextPct = 0.32,
  placeholder,
  value,
  caretAtEnd = true,
  caretOn = true,
  promptSuggestion,
  mentions = [],
  pasteChips = [],
  attachments = [],
  miniAppContexts = [],
  userSelections = [],
  isDragging = false,
  additionalDirs = [],
  mentionPopup,
  slashPopup,
  className,
  overlay,
}: ChatInputAdvancedMockProps) {
  const t = useMockT()
  const model = modelLabel ?? DEFAULT_MODEL[harness]
  const effort = effortLabel ?? t("settings.preferences.effort.levels.xhigh")
  const placeholderText =
    placeholder ?? t(harness === "codex" ? "chat.placeholder.codexAsk" : "chat.placeholder.claudeAsk")

  const trimmedValue = value ?? ""
  const hasTypedValue = trimmedValue.length > 0
  const hasChips = mentions.length > 0 || pasteChips.length > 0
  const editorEmpty = !hasTypedValue && !hasChips

  const showSuggestion = editorEmpty && !!promptSuggestion
  const showPlaceholder = editorEmpty && !showSuggestion

  const canSend = hasTypedValue || hasChips || attachments.length > 0 || mentions.length > 0

  return (
    <div className={cn("@container mx-auto w-full min-w-0 max-w-3xl", className)}>
      <div
        className={cn(
          "relative mx-3 mb-1 rounded-xl border border-border bg-card px-4 py-3",
          isDragging && "ring-2 ring-inset ring-blue-500/50",
        )}
      >
        {additionalDirs.length > 0 && <DirsHintBar dirs={additionalDirs} />}
        {mentionPopup && <MentionPopupBar popup={mentionPopup} />}
        {slashPopup && <SlashPopupBar popup={slashPopup} />}

        {attachments.length > 0 && <AttachmentStrip attachments={attachments} />}

        {(miniAppContexts.length > 0 || userSelections.length > 0) && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {userSelections.map((sel, i) => (
              <UserSelectionChipView key={`sel-${i}`} selection={sel} />
            ))}
            {miniAppContexts.map((ctx) => (
              <MiniAppContextChipView key={ctx.appId} ctx={ctx} />
            ))}
          </div>
        )}

        <div className="relative">
          {pasteChips.length > 0 && (
            <div className="mb-1 flex flex-col gap-1">
              {pasteChips.map((chip, i) => (
                <PasteChipView key={`paste-${i}`} chip={chip} />
              ))}
            </div>
          )}

          <EditorLine
            mentions={mentions}
            value={trimmedValue}
            caretAtEnd={caretAtEnd}
            caretOn={caretOn}
          />

          {showPlaceholder && (
            <div className="pointer-events-none absolute inset-0 select-none text-[15px] leading-6 text-muted-foreground/70">
              {placeholderText}
            </div>
          )}
          {showSuggestion && promptSuggestion && (
            <PromptSuggestionGhost text={promptSuggestion} />
          )}
        </div>

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Attach"
            >
              <Paperclip className="size-3.5" />
            </button>

            <button
              type="button"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <span className="max-w-[140px] truncate">{model}</span>
              <ChevronDown className="size-3" />
            </button>

            <button
              type="button"
              className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <span className="max-w-[100px] truncate">{effort}</span>
              <ChevronDown className="size-3" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <ContextDial pct={contextPct} />
            <button
              type="button"
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors",
                canSend ? "bg-primary text-primary-foreground border-primary" : "opacity-30",
              )}
              aria-label="Send"
            >
              <ArrowUp className="size-3.5" />
            </button>
          </div>
        </div>

        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-blue-500 bg-blue-500/10">
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Drop to attach
            </span>
          </div>
        )}

        {overlay}
      </div>

      <ChatStatusFooter
        harness={harness}
        workDirName={workDirName}
        branch={branch}
        branchDirty={branchDirty}
        permissionLabel={permissionLabel}
        sandboxLabel={sandboxLabel}
      />
    </div>
  )
}

function EditorLine({
  mentions,
  value,
  caretAtEnd,
  caretOn,
}: {
  mentions: MentionChipMock[]
  value: string
  caretAtEnd: boolean
  caretOn: boolean
}) {
  return (
    <div className="min-h-[36px] text-[15px] leading-6 text-foreground">
      <span className="inline-flex flex-wrap items-center gap-y-1 align-baseline">
        {mentions.map((m, i) => (
          <MentionChipView key={`mention-${i}`} mention={m} />
        ))}
        {value && <span className="whitespace-pre-wrap break-words">{value}</span>}
        {caretAtEnd && (
          <span
            aria-hidden
            className={cn(
              "ml-px inline-block h-[18px] w-px translate-y-[3px] bg-foreground/80",
              !caretOn && "opacity-0",
            )}
          />
        )}
      </span>
    </div>
  )
}

function PromptSuggestionGhost({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-start text-[15px] leading-6 text-muted-foreground/70">
      <span className="inline-flex max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap select-none">
        <span className="min-w-0 truncate">{text}</span>
        <kbd className="shrink-0 rounded border border-border bg-muted px-[5px] py-[2px] font-sans text-[10px] leading-none text-muted-foreground">
          Tab
        </kbd>
      </span>
    </div>
  )
}

function MentionChipView({ mention }: { mention: MentionChipMock }) {
  const { kind, displayName } = mention
  return (
    <span
      className="inline-flex h-4 max-h-4 items-center gap-0.5 overflow-hidden rounded bg-muted mx-0.5 px-1.5 text-[0.875rem] leading-none text-foreground select-none whitespace-nowrap align-middle"
      data-mention=""
    >
      {kind === "agent" ? (
        <Bot className="size-3 shrink-0 text-purple-600 dark:text-purple-400" />
      ) : kind === "directory" ? (
        <Folder className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
      ) : (
        <FileIcon name={displayName} size={12} className="size-3 shrink-0" />
      )}
      <span className="max-w-[120px] truncate leading-none">
        {kind === "agent" && displayName.includes(":") ? displayName.split(":").pop() : displayName}
      </span>
      <span className="ml-0.5 text-muted-foreground">
        <X className="size-2.5" />
      </span>
    </span>
  )
}

function PasteChipView({ chip }: { chip: PasteChipMock }) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm text-foreground select-none transition-colors",
        chip.selected
          ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30"
          : "border-border bg-muted/50",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-muted-foreground">{chip.preview}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{chip.lineCount} lines</span>
      </div>
      <button type="button" className="shrink-0 text-muted-foreground">
        <UnfoldVertical className="size-3.5" />
      </button>
      <button type="button" className="shrink-0 text-muted-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function AttachmentStrip({ attachments }: { attachments: AttachmentMock[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attachments.map((att, i) => (
        <div
          key={`att-${i}`}
          className="group relative size-12 overflow-hidden rounded border border-border bg-background"
          title={att.name}
        >
          {att.type === "pdf" ? (
            <PdfThumbnailMock pages={att.pages ?? 8} />
          ) : (
            <ImageThumbnailMock thumb={att.thumbnail} />
          )}
        </div>
      ))}
    </div>
  )
}

function ImageThumbnailMock({ thumb }: { thumb: ImageThumbnailKind }) {
  if (thumb.kind === "screenshot") {
    const a = `hsl(${thumb.hueA} 70% 60%)`
    const b = `hsl(${thumb.hueB} 70% 45%)`
    return (
      <svg viewBox="0 0 48 48" className="size-full">
        <defs>
          <linearGradient id={`grad-${thumb.hueA}-${thumb.hueB}-s`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
        </defs>
        <rect width="48" height="48" fill={`url(#grad-${thumb.hueA}-${thumb.hueB}-s)`} />
        <rect x="4" y="6" width="40" height="3" rx="1" fill="white" opacity="0.85" />
        <rect x="4" y="14" width="28" height="2" rx="1" fill="white" opacity="0.55" />
        <rect x="4" y="20" width="34" height="2" rx="1" fill="white" opacity="0.55" />
        <rect x="4" y="28" width="40" height="14" rx="2" fill="white" opacity="0.7" />
        <rect x="7" y="31" width="20" height="2" rx="1" fill={b} opacity="0.6" />
        <rect x="7" y="36" width="14" height="2" rx="1" fill={b} opacity="0.45" />
      </svg>
    )
  }
  if (thumb.kind === "photo") {
    const a = `hsl(${thumb.hueA} 65% 55%)`
    const b = `hsl(${thumb.hueB} 75% 25%)`
    return (
      <svg viewBox="0 0 48 48" className="size-full">
        <defs>
          <radialGradient id={`grad-${thumb.hueA}-${thumb.hueB}-p`} cx="0.3" cy="0.2" r="0.9">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </radialGradient>
        </defs>
        <rect width="48" height="48" fill={`url(#grad-${thumb.hueA}-${thumb.hueB}-p)`} />
        <circle cx="36" cy="12" r="4" fill="white" opacity="0.8" />
        <path d="M0 36 L16 22 L26 32 L36 22 L48 34 L48 48 L0 48 Z" fill="white" opacity="0.25" />
        <path d="M0 42 L18 30 L30 40 L40 32 L48 38 L48 48 L0 48 Z" fill="black" opacity="0.35" />
      </svg>
    )
  }
  if (thumb.kind === "diagram") {
    const c = `hsl(${thumb.accent} 70% 55%)`
    return (
      <svg viewBox="0 0 48 48" className="size-full">
        <rect width="48" height="48" fill="white" />
        <circle cx="12" cy="12" r="4" fill={c} />
        <circle cx="36" cy="14" r="4" fill={c} opacity="0.6" />
        <circle cx="24" cy="32" r="4" fill={c} opacity="0.8" />
        <path d="M14 14 L34 16" stroke={c} strokeWidth="1.2" opacity="0.7" />
        <path d="M14 14 L24 30" stroke={c} strokeWidth="1.2" opacity="0.7" />
        <path d="M36 16 L26 30" stroke={c} strokeWidth="1.2" opacity="0.7" />
      </svg>
    )
  }
  const c = `hsl(${thumb.accent} 65% 55%)`
  return (
    <svg viewBox="0 0 48 48" className="size-full">
      <rect width="48" height="48" fill="#0F172A" />
      <rect x="3" y="6" width="14" height="2" rx="1" fill={c} />
      <rect x="3" y="11" width="22" height="2" rx="1" fill="#60a5fa" />
      <rect x="6" y="16" width="28" height="2" rx="1" fill="#e2e8f0" />
      <rect x="6" y="21" width="18" height="2" rx="1" fill="#f472b6" />
      <rect x="3" y="26" width="10" height="2" rx="1" fill={c} />
      <rect x="3" y="31" width="34" height="2" rx="1" fill="#94a3b8" />
      <rect x="6" y="36" width="20" height="2" rx="1" fill="#facc15" />
      <rect x="6" y="41" width="14" height="2" rx="1" fill="#34d399" />
    </svg>
  )
}

function PdfThumbnailMock({ pages }: { pages: number }) {
  return (
    <svg viewBox="0 0 48 48" className="size-full">
      <rect width="48" height="48" fill="#f8fafc" />
      <rect x="6" y="3" width="32" height="42" rx="2" fill="white" stroke="#cbd5e1" strokeWidth="0.5" />
      <rect x="9" y="7" width="18" height="2" rx="1" fill="#1e293b" />
      <rect x="9" y="12" width="26" height="1.2" rx="0.6" fill="#94a3b8" />
      <rect x="9" y="15.5" width="22" height="1.2" rx="0.6" fill="#94a3b8" />
      <rect x="9" y="19" width="26" height="1.2" rx="0.6" fill="#94a3b8" />
      <rect x="9" y="22.5" width="14" height="1.2" rx="0.6" fill="#94a3b8" />
      <rect x="9" y="28" width="26" height="6" rx="1" fill="#fee2e2" />
      <rect x="9" y="36" width="22" height="1.2" rx="0.6" fill="#94a3b8" />
      <rect x="9" y="39.5" width="18" height="1.2" rx="0.6" fill="#94a3b8" />
      <rect x="0" y="34" width="20" height="11" rx="2" fill="#dc2626" />
      <text
        x="10"
        y="42"
        textAnchor="middle"
        fontSize="6"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fill="white"
      >
        PDF
      </text>
      <text
        x="34"
        y="44"
        textAnchor="end"
        fontSize="4"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fill="#94a3b8"
      >
        {pages}p
      </text>
    </svg>
  )
}

function MiniAppContextChipView({ ctx }: { ctx: MiniAppContextChipMock }) {
  const c = ctx.color
  const isSuggest = ctx.mode === "suggest"
  const isActive = isSuggest ? !!ctx.checked : true
  const monogram = (ctx.monogram ?? ctx.appName).slice(0, 1).toUpperCase()

  const style: CSSProperties = {
    background: isActive ? `${c}22` : "transparent",
    border: isSuggest && !isActive ? `1px dashed ${c}` : `1px solid ${isActive ? `${c}22` : "transparent"}`,
    color: c,
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap select-none transition-opacity",
        !isActive && "opacity-60",
      )}
      style={style}
    >
      <span
        className="inline-flex size-3 shrink-0 items-center justify-center rounded-sm text-[8px] font-bold text-white"
        style={{ background: c }}
      >
        {monogram}
      </span>
      <span className="max-w-[140px] truncate font-medium">{ctx.appName}</span>
      {ctx.summary && (
        <>
          <span className="opacity-50" style={{ fontSize: 10 }}>·</span>
          <span className="max-w-[160px] truncate" style={{ fontSize: 11, opacity: 0.75 }}>
            {ctx.summary}
          </span>
        </>
      )}
      {isSuggest ? (
        ctx.checked ? <Check className="size-3" /> : <Square className="size-3" />
      ) : (
        <X className="size-2.5 opacity-70" />
      )}
    </span>
  )
}

function UserSelectionChipView({ selection }: { selection: UserSelectionChipMock }) {
  const isMulti = (selection.count ?? 0) > 1
  const fileName =
    selection.filePath?.split(/[/\\]/).filter(Boolean).pop() ?? selection.filePath ?? ""

  return (
    <span className="group inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-sm text-foreground/85 whitespace-nowrap select-none">
      {isMulti ? (
        <>
          <Quote className="size-2.5 shrink-0 text-primary/60" />
          <span className="max-w-[220px] truncate">{selection.count} selections</span>
        </>
      ) : fileName ? (
        <span className="inline-flex items-center gap-1 min-w-0 overflow-hidden">
          <FileIcon name={fileName} size={13} className="shrink-0" />
          <span className="shrink-0 whitespace-nowrap font-medium">{fileName}</span>
          {selection.rangeText && (
            <span className="min-w-0 truncate font-mono text-muted-foreground/70">{selection.rangeText}</span>
          )}
        </span>
      ) : (
        <>
          <Quote className="size-2.5 shrink-0 text-primary/60" />
          <span className="max-w-[220px] truncate">{selection.preview}</span>
        </>
      )}
      <span className="ml-0.5 text-muted-foreground/70">
        <X className="size-3" />
      </span>
    </span>
  )
}

function DirsHintBar({ dirs }: { dirs: ChatInputDirHintMock[] }) {
  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1 flex items-center gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
      <span className="ml-1 mr-0.5 shrink-0 text-[11px] text-muted-foreground/70">Additional dirs</span>
      {dirs.map((d) => (
        <span
          key={`${d.scope}-${d.name}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
        >
          <Folder className="size-3 shrink-0 text-blue-500" />
          <span>{d.name}</span>
          <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
            {d.scope}
          </span>
        </span>
      ))}
    </div>
  )
}

function HighlightedText({
  text,
  indices,
}: {
  text: string
  indices?: number[]
}) {
  if (!indices || indices.length === 0) return <>{text}</>
  const set = new Set(indices)
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="text-orange-600 dark:text-orange-400 font-medium">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  )
}

function MentionPopupBar({ popup }: { popup: MentionPopupMock }) {
  const activeIndex = popup.activeIndex ?? 0
  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-72 overflow-hidden rounded-xl border border-border bg-card flex flex-col">
      <div className="overflow-y-auto p-1 flex-1 min-h-0">
        {popup.breadcrumbs && popup.breadcrumbs.length > 0 && (
          <div className="flex items-center gap-0.5 px-2 py-1 text-[10px] text-muted-foreground">
            {popup.breadcrumbs.map((seg, i) => (
              <span key={i} className="flex items-center gap-0.5">
                {i > 0 && <span>/</span>}
                <span className="hover:text-foreground">{seg}</span>
              </span>
            ))}
          </div>
        )}
        {popup.items.map((item, i) => (
          <button
            key={`${item.kind}-${item.name}-${i}`}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
              i === activeIndex ? "bg-muted text-foreground" : "text-foreground hover:bg-muted/50",
            )}
          >
            {item.kind === "agent" ? (
              <Bot className="size-3.5 shrink-0 text-purple-600 dark:text-purple-400" />
            ) : item.kind === "directory" ? (
              <Folder className="size-3.5 shrink-0 text-blue-500" />
            ) : (
              <FileIcon name={item.name} size={14} />
            )}
            <span className="min-w-0 truncate">
              {item.kind === "agent" ? (
                <span className="font-medium text-purple-600 dark:text-purple-400">
                  <HighlightedText text={item.name} indices={item.matchIndices} />
                </span>
              ) : (
                <HighlightedText text={item.name} indices={item.matchIndices} />
              )}
            </span>
            {item.subtitle && (
              <span className="ml-auto shrink-0 rounded bg-muted/60 px-1 py-px text-[10px] text-muted-foreground">
                {item.subtitle}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground shrink-0">
        <Kbd>tab</Kbd> autocomplete
        <span className="mx-1.5">·</span>
        <Kbd>↵</Kbd> select
        <span className="mx-1.5">·</span>
        <Kbd>↑↓</Kbd> navigate
        <span className="mx-1.5">·</span>
        <Kbd>esc</Kbd> close
      </div>
    </div>
  )
}

function SlashPopupBar({ popup }: { popup: SlashPopupMock }) {
  const t = useMockT()
  const activeIndex = popup.activeIndex ?? 0
  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1 flex max-h-64 flex-col overflow-hidden rounded-xl border border-border bg-card p-1.5">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {popup.commands.map((cmd, i) => {
          const nameIndices = [0, ...(cmd.matchIndices ?? []).map((x) => x + 1)]
          return (
            <button
              key={cmd.name}
              type="button"
              className={cn(
                "flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-xs transition-colors",
                i === activeIndex
                  ? "bg-muted text-foreground"
                  : "text-foreground hover:bg-muted/50",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5 font-medium">
                <span className="text-blue-600 dark:text-blue-400">
                  <HighlightedText text={`/${cmd.name}`} indices={nameIndices} />
                </span>
                {cmd.argumentHint && (
                  <span className="truncate text-muted-foreground font-normal">{cmd.argumentHint}</span>
                )}
                {cmd.isSkill && (
                  <span className="rounded bg-emerald-100 px-1 py-px text-[10px] font-normal text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                    {t("chat.slashCommand.skillBadge")}
                  </span>
                )}
              </span>
              {cmd.description && (
                <span className="line-clamp-2 text-muted-foreground leading-snug">{cmd.description}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface ChatStatusFooterProps {
  harness: Harness
  workDirName: string
  branch: string
  branchDirty: boolean
  permissionLabel: string
  sandboxLabel: "Off" | "On" | "Auto"
}

const SANDBOX_COLOR: Record<"Off" | "On" | "Auto", string> = {
  Off: "text-muted-foreground hover:bg-muted",
  On: "text-emerald-500 hover:bg-emerald-500/10 dark:text-emerald-400",
  Auto: "text-amber-600 hover:bg-amber-500/10 dark:text-amber-400",
}

function ChatStatusFooter({
  harness,
  workDirName,
  branch,
  branchDirty,
  permissionLabel,
  sandboxLabel,
}: ChatStatusFooterProps) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap px-3 pb-1 pt-0.5 @lg:px-7 @lg:pb-3 @lg:pt-1 text-[11px] text-muted-foreground">
      <button
        type="button"
        className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
        title={workDirName}
      >
        <FolderClosed className="size-3" />
        <span className="max-w-[140px] truncate">{workDirName}</span>
      </button>
      <div className="h-3 w-px bg-border" />
      <button
        type="button"
        className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
      >
        <GitBranch className="size-3" />
        <span className="max-w-[140px] truncate">{branch}</span>
        {branchDirty && <Circle className="size-1.5 fill-amber-500 text-amber-500" />}
        <ChevronDown className="size-3" />
      </button>
      <div className="h-3 w-px bg-border" />
      <button
        type="button"
        className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
      >
        <Shield className="size-3" />
        <span>{permissionLabel}</span>
        <ChevronDown className="size-3" />
      </button>
      <div className="flex-1" />
      {harness === "claude" && (
        <button
          type="button"
          className={cn(
            "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors",
            SANDBOX_COLOR[sandboxLabel],
          )}
          title={`Sandbox ${sandboxLabel}`}
        >
          <span className="inline-block size-3 rounded-sm border border-current" />
          <span>{sandboxLabel}</span>
          <ChevronDown className="size-3" />
        </button>
      )}
    </div>
  )
}

function ContextDial({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(1, pct))
  const radius = 5
  const circumference = 2 * Math.PI * radius
  const used = circumference * clamped
  const color = clamped > 0.7 ? "#ef4444" : clamped > 0.4 ? "#f59e0b" : "#22c55e"
  return (
    <span
      aria-label={`Context ${(clamped * 100).toFixed(0)}%`}
      className="flex items-center rounded-sm p-1"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        <circle cx="7" cy="7" r={radius} fill="none" className="stroke-border" strokeWidth="2" />
        {clamped > 0 && (
          <circle
            cx="7"
            cy="7"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeDasharray={`${used} ${circumference - used}`}
            strokeDashoffset={circumference * 0.25}
            strokeLinecap="round"
          />
        )}
      </svg>
    </span>
  )
}
