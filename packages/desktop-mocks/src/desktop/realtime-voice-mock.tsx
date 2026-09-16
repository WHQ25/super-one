"use client"

import { useCallback, useState, type CSSProperties } from "react"
import { AudioLines, Loader2, MessageSquare, X } from "lucide-react"
import { IconButton } from "@superone/ui/components/ui/icon-button"
import { CodexCloudMark, CodexCloudOutline } from "@superone/ui/components/harness/CodexSessionIcon"
import { cn } from "@superone/ui/lib/utils"
import { ChatBody, type MockMessage } from "./chat-mock"
import { useMockT } from "./i18n"

export type RealtimeVoiceState = "idle" | "starting" | "active" | "stopping"
export type CodexConversationView = "thread" | "realtime"

/** One spoken turn. The desktop renders these through the ordinary chat turn UI. */
export interface RealtimeTurnMock {
  id: string
  role: "user" | "assistant"
  text: string
}

/** Live captions flanking the voice mark while someone is mid-sentence. */
export interface RealtimeCaptionsMock {
  user?: string
  assistant?: string
}

export const DEFAULT_REALTIME_TURNS: readonly RealtimeTurnMock[] = [
  {
    id: "voice-user-1",
    role: "user",
    text: "Can you walk through the new session lifecycle before we change it?",
  },
  {
    id: "voice-assistant-1",
    role: "assistant",
    text: "Yes. A session now keeps the provider thread, runtime, and view state separate.",
  },
  {
    id: "voice-user-2",
    role: "user",
    text: "Start with the handoff between the runtime and the renderer.",
  },
  {
    id: "voice-assistant-2",
    role: "assistant",
    text: "The runtime publishes normalized events; the renderer only derives presentation state.",
  },
  {
    id: "voice-user-3",
    role: "user",
    text: "Pick up where we left off and turn that into a small implementation plan.",
  },
]

export const DEFAULT_REALTIME_CAPTIONS: RealtimeCaptionsMock = {
  assistant: "I'll keep the store boundary, add the event mapping, then cover the transition with tests.",
}

/** The backing Codex thread: what the debug view shows behind the spoken line. */
export const DEFAULT_REALTIME_THREAD_MESSAGES: readonly RealtimeTurnMock[] = [
  {
    id: "thread-user-1",
    role: "user",
    text: "Can you walk through the new session lifecycle before we change it?",
  },
  {
    id: "thread-assistant-1",
    role: "assistant",
    text: "Yes. I'll trace the provider thread, runtime ownership, and renderer state separately.",
  },
  {
    id: "thread-user-2",
    role: "user",
    text: "Start with the handoff between the runtime and the renderer.",
  },
  {
    id: "thread-assistant-2",
    role: "assistant",
    text: "The runtime publishes normalized events. The renderer consumes those events without owning the provider connection.",
  },
]

interface ControllableValueOptions<T> {
  value: T | undefined
  defaultValue: T
  onChange?: (value: T) => void
}

function useControllableValue<T>({
  value,
  defaultValue,
  onChange,
}: ControllableValueOptions<T>): readonly [T, (next: T) => void] {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue)
  const currentValue = value ?? uncontrolledValue
  const setValue = useCallback(
    (next: T) => {
      if (value === undefined) setUncontrolledValue(next)
      onChange?.(next)
    },
    [onChange, value],
  )

  return [currentValue, setValue] as const
}

export interface CodexRealtimeVoiceButtonMockProps {
  state?: RealtimeVoiceState
  defaultState?: RealtimeVoiceState
  disabled?: boolean
  className?: string
  onStateChange?: (state: RealtimeVoiceState) => void
}

export function CodexRealtimeVoiceButtonMock({
  state,
  defaultState = "idle",
  disabled = false,
  className,
  onStateChange,
}: CodexRealtimeVoiceButtonMockProps) {
  const t = useMockT()
  const [currentState, setCurrentState] = useControllableValue({
    value: state,
    defaultValue: defaultState,
    onChange: onStateChange,
  })
  const active = currentState === "active" || currentState === "stopping"
  const busy = currentState === "starting" || currentState === "stopping"

  return (
    <IconButton
      size="sm"
      variant="ghost"
      disabled={disabled || busy}
      tooltip={t(active ? "chat.realtimeVoice.stop" : "chat.realtimeVoice.start")}
      aria-pressed={active}
      className={cn(
        "rounded-full border",
        active
          ? "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground"
          : "border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background",
        className,
      )}
      onClick={() => setCurrentState(active ? "idle" : "active")}
    >
      {busy ? <Loader2 className="animate-spin" /> : active ? <X /> : <AudioLines />}
    </IconButton>
  )
}

export interface CodexConversationViewToggleMockProps {
  view?: CodexConversationView
  defaultView?: CodexConversationView
  enabled?: boolean
  hasTimeline?: boolean
  className?: string
  onViewChange?: (view: CodexConversationView) => void
}

/** Header-level escape hatch between the primary voice line and its backing thread. */
export function CodexConversationViewToggleMock({
  view,
  defaultView = "realtime",
  enabled = true,
  hasTimeline = true,
  className,
  onViewChange,
}: CodexConversationViewToggleMockProps) {
  const t = useMockT()
  const [currentView, setCurrentView] = useControllableValue({
    value: view,
    defaultValue: defaultView,
    onChange: onViewChange,
  })

  if (!enabled || !hasTimeline) return null

  const showingRealtime = currentView === "realtime"
  const label = t(showingRealtime ? "chat.realtimeVoice.showDebugThread" : "chat.realtimeVoice.showTimeline")

  return (
    <IconButton
      size="sm"
      tooltip={label}
      aria-pressed={showingRealtime}
      className={className}
      onClick={() => setCurrentView(showingRealtime ? "thread" : "realtime")}
    >
      {showingRealtime ? <MessageSquare className="size-[13px]" /> : <AudioLines />}
    </IconButton>
  )
}

const MARK_SIZE = 64
const GLYPH_SIZE = 23

export type RealtimeActivityMock = "listening" | "user-speaking" | "assistant-speaking" | "thinking"

function CaptionColumn({ text, side }: { text: string; side: "left" | "right" }) {
  return (
    <div className="flex min-w-0 flex-1 items-center overflow-hidden" style={{ height: MARK_SIZE }}>
      <p
        className={cn(
          "w-full break-words text-xs leading-snug",
          side === "left" ? "text-right text-muted-foreground" : "text-left text-foreground",
        )}
      >
        {text}
      </p>
    </div>
  )
}

export interface RealtimeCallIndicatorMockProps {
  captions?: RealtimeCaptionsMock
  activity?: RealtimeActivityMock
  /** 0–1 microphone level; only visible while the user is speaking. */
  inputLevel?: number
  className?: string
}

/**
 * Persistent "a voice call is running" marker above the composer: the Codex
 * cloud reflecting listening/speech, with live captions flanking it by speaker
 * (assistant on the left, user on the right). Purely a status surface — every
 * control over the call lives in the composer toolbar.
 */
export function RealtimeCallIndicatorMock({
  captions = {},
  activity = "listening",
  inputLevel = 0.6,
  className,
}: RealtimeCallIndicatorMockProps) {
  const t = useMockT()
  const level = activity === "user-speaking" ? inputLevel : 0
  return (
    <div
      aria-label={t("chat.realtimeVoice.listening")}
      className={cn("flex items-center justify-center gap-3 px-2 py-2", className)}
    >
      <CaptionColumn text={captions.assistant ?? ""} side="left" />
      <span
        data-activity={activity}
        className="relative inline-flex shrink-0 items-center justify-center text-primary"
        style={{ "--voice-level": level } as CSSProperties}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ transform: `scale(${1.08 + level * 0.14})` }}
        >
          <CodexCloudOutline
            size={MARK_SIZE}
            className={cn("absolute overflow-visible", activity === "listening" ? "opacity-25" : "opacity-60")}
          />
        </span>
        <span
          className="relative inline-flex"
          style={{ transform: `scale(${1 + level * 0.09})` }}
        >
          <CodexCloudMark size={MARK_SIZE} motion={activity === "thinking" ? "running" : "still"}>
            <AudioLines
              className="text-white"
              strokeWidth={2}
              style={{ width: GLYPH_SIZE, height: GLYPH_SIZE }}
              aria-hidden
            />
          </CodexCloudMark>
        </span>
      </span>
      <CaptionColumn text={captions.user ?? ""} side="right" />
    </div>
  )
}

export interface RealtimeVoiceMockProps {
  view?: CodexConversationView
  defaultView?: CodexConversationView
  voiceState?: RealtimeVoiceState
  defaultVoiceState?: RealtimeVoiceState
  hasTimeline?: boolean
  /** Spoken turns; rendered through the same turn UI as typed chat. */
  turns?: readonly RealtimeTurnMock[]
  /** Backing Codex thread shown by the debug view. */
  threadMessages?: readonly RealtimeTurnMock[]
  captions?: RealtimeCaptionsMock
  activity?: RealtimeActivityMock
  title?: string
  className?: string
  onViewChange?: (view: CodexConversationView) => void
  onVoiceStateChange?: (state: RealtimeVoiceState) => void
}

function toMessages(turns: readonly RealtimeTurnMock[]): MockMessage[] {
  return turns.map((turn) => ({ id: turn.id, role: turn.role, text: turn.text }))
}

/**
 * A Codex session mid-call. The transcript is the ordinary chat thread — voice
 * turns are not a separate timeline any more — and the call announces itself
 * through the cloud indicator above the composer plus the red stop button.
 */
export function RealtimeVoiceMock({
  view,
  defaultView = "realtime",
  voiceState,
  defaultVoiceState = "active",
  hasTimeline = true,
  turns = DEFAULT_REALTIME_TURNS,
  threadMessages = DEFAULT_REALTIME_THREAD_MESSAGES,
  captions = DEFAULT_REALTIME_CAPTIONS,
  activity = "assistant-speaking",
  title = "Session lifecycle walkthrough",
  className,
  onViewChange,
  onVoiceStateChange,
}: RealtimeVoiceMockProps) {
  const t = useMockT()
  const [currentView, setCurrentView] = useControllableValue({
    value: view,
    defaultValue: defaultView,
    onChange: onViewChange,
  })
  const [currentVoiceState] = useControllableValue({
    value: voiceState,
    defaultValue: defaultVoiceState,
    onChange: onVoiceStateChange,
  })
  const live = currentVoiceState === "active" || currentVoiceState === "stopping"
  const messages = currentView === "realtime" ? toMessages(turns) : toMessages(threadMessages)

  return (
    <section
      className={cn(
        "flex h-[34rem] w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card",
        className,
      )}
      aria-label={t("chat.realtimeVoice.listening")}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 pl-3 pr-2 pt-[2px]">
        <span className="max-w-[260px] truncate text-xs text-muted-foreground">{title}</span>
        <div className="flex-1" />
        <CodexConversationViewToggleMock
          view={currentView}
          hasTimeline={hasTimeline}
          onViewChange={setCurrentView}
        />
      </header>
      <div className="min-h-0 flex-1">
        {messages.length > 0 ? (
          <ChatBody
            harness="codex"
            messages={messages}
            showFooter={false}
            voiceState={currentVoiceState}
            beforeComposer={live && <RealtimeCallIndicatorMock captions={captions} activity={activity} />}
          />
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {t(live ? "chat.realtimeVoice.waiting" : "chat.realtimeVoice.emptyTimeline")}
          </p>
        )}
      </div>
    </section>
  )
}
