"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AudioLines, Loader2, MessageSquare, X } from "lucide-react";
import { IconButton } from "@superone/ui/components/ui/icon-button";
import { ScrollArea } from "@superone/ui/components/ui/scroll-area";
import { cn } from "@superone/ui/lib/utils";
import { useMockLocale, useMockT } from "./i18n";

export type RealtimeVoiceState = "idle" | "starting" | "active" | "stopping";
export type CodexConversationView = "thread" | "realtime";

export interface RealtimeTimelineSegmentMock {
  id: string;
  realtimeSessionId: string;
  role: "user" | "assistant";
  text: string;
  startedAtMs?: number;
}

export interface RealtimeThreadMessageMock {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const SAMPLE_CALL_STARTED_AT_MS = Date.UTC(2026, 7, 29, 10, 15);

export const DEFAULT_REALTIME_TIMELINE_SEGMENTS: readonly RealtimeTimelineSegmentMock[] =
  [
    {
      id: "call-1-user-1",
      realtimeSessionId: "realtime-1",
      role: "user",
      text: "Can you walk through the new session lifecycle before we change it?",
      startedAtMs: SAMPLE_CALL_STARTED_AT_MS,
    },
    {
      id: "call-1-assistant-1",
      realtimeSessionId: "realtime-1",
      role: "assistant",
      text: "Yes. A session now keeps the provider thread, runtime, and view state separate.",
      startedAtMs: SAMPLE_CALL_STARTED_AT_MS + 11_000,
    },
    {
      id: "call-1-user-2",
      realtimeSessionId: "realtime-1",
      role: "user",
      text: "Start with the handoff between the runtime and the renderer.",
      startedAtMs: SAMPLE_CALL_STARTED_AT_MS + 61_000,
    },
    {
      id: "call-1-assistant-2",
      realtimeSessionId: "realtime-1",
      role: "assistant",
      text: "The runtime publishes normalized events; the renderer only derives presentation state.",
      startedAtMs: SAMPLE_CALL_STARTED_AT_MS + 70_000,
    },
    {
      id: "call-2-user-1",
      realtimeSessionId: "realtime-2",
      role: "user",
      text: "Pick up where we left off and turn that into a small implementation plan.",
      startedAtMs: SAMPLE_CALL_STARTED_AT_MS + 7_200_000,
    },
    {
      id: "call-2-assistant-1",
      realtimeSessionId: "realtime-2",
      role: "assistant",
      text: "I’ll keep the store boundary, add the event mapping, then cover the transition with tests.",
      startedAtMs: SAMPLE_CALL_STARTED_AT_MS + 7_208_000,
    },
  ];

export const DEFAULT_REALTIME_THREAD_MESSAGES: readonly RealtimeThreadMessageMock[] =
  [
    {
      id: "thread-user-1",
      role: "user",
      text: "Can you walk through the new session lifecycle before we change it?",
    },
    {
      id: "thread-assistant-1",
      role: "assistant",
      text: "Yes. I’ll trace the provider thread, runtime ownership, and renderer state separately.",
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
  ];

interface ControllableValueOptions<T> {
  value: T | undefined;
  defaultValue: T;
  onChange?: (value: T) => void;
}

function useControllableValue<T>({
  value,
  defaultValue,
  onChange,
}: ControllableValueOptions<T>): readonly [T, (next: T) => void] {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const currentValue = value ?? uncontrolledValue;
  const setValue = useCallback(
    (next: T) => {
      if (value === undefined) setUncontrolledValue(next);
      onChange?.(next);
    },
    [onChange, value],
  );

  return [currentValue, setValue] as const;
}

export interface CodexRealtimeVoiceButtonMockProps {
  state?: RealtimeVoiceState;
  defaultState?: RealtimeVoiceState;
  disabled?: boolean;
  className?: string;
  onStateChange?: (state: RealtimeVoiceState) => void;
}

export function CodexRealtimeVoiceButtonMock({
  state,
  defaultState = "idle",
  disabled = false,
  className,
  onStateChange,
}: CodexRealtimeVoiceButtonMockProps) {
  const t = useMockT();
  const [currentState, setCurrentState] = useControllableValue({
    value: state,
    defaultValue: defaultState,
    onChange: onStateChange,
  });
  const active = currentState === "active" || currentState === "stopping";
  const busy = currentState === "starting" || currentState === "stopping";

  return (
    <IconButton
      size="sm"
      variant="ghost"
      disabled={disabled || busy}
      tooltip={t(
        active ? "chat.realtimeVoice.stop" : "chat.realtimeVoice.start",
      )}
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
      {busy ? (
        <Loader2 className="animate-spin" />
      ) : active ? (
        <X />
      ) : (
        <AudioLines />
      )}
    </IconButton>
  );
}

export interface CodexConversationViewToggleMockProps {
  view?: CodexConversationView;
  defaultView?: CodexConversationView;
  enabled?: boolean;
  hasTimeline?: boolean;
  className?: string;
  onViewChange?: (view: CodexConversationView) => void;
}

export function CodexConversationViewToggleMock({
  view,
  defaultView = "thread",
  enabled = true,
  hasTimeline = true,
  className,
  onViewChange,
}: CodexConversationViewToggleMockProps) {
  const t = useMockT();
  const [currentView, setCurrentView] = useControllableValue({
    value: view,
    defaultValue: defaultView,
    onChange: onViewChange,
  });

  if (!enabled) return null;

  const showingRealtime = currentView === "realtime";
  if (!showingRealtime && !hasTimeline) return null;

  const label = t(
    showingRealtime
      ? "chat.realtimeVoice.showConversation"
      : "chat.realtimeVoice.showTimeline",
  );

  return (
    <IconButton
      size="sm"
      tooltip={label}
      aria-pressed={showingRealtime}
      className={cn(
        showingRealtime ? "text-foreground" : "text-muted-foreground/60",
        className,
      )}
      onClick={() => setCurrentView(showingRealtime ? "thread" : "realtime")}
    >
      {showingRealtime ? <MessageSquare /> : <AudioLines />}
    </IconButton>
  );
}

const SILENCE_THRESHOLD_SECONDS = 30;

interface RealtimeTimelineRowMock {
  segment: RealtimeTimelineSegmentMock;
  offsetSeconds: number | null;
  silenceSeconds: number | null;
  callStart: boolean;
  callStartedAtMs: number | null;
}

function buildRealtimeTimelineRows(
  segments: readonly RealtimeTimelineSegmentMock[],
): RealtimeTimelineRowMock[] {
  const rows: RealtimeTimelineRowMock[] = [];
  let callId: string | null = null;
  let callStartedAtMs: number | null = null;
  let previousStampMs: number | null = null;

  for (const segment of segments) {
    const startsCall = segment.realtimeSessionId !== callId;
    if (startsCall) {
      callId = segment.realtimeSessionId;
      callStartedAtMs = null;
      previousStampMs = null;
    }
    if (segment.startedAtMs !== undefined && callStartedAtMs === null) {
      callStartedAtMs = segment.startedAtMs;
    }

    const offsetSeconds =
      segment.startedAtMs === undefined || callStartedAtMs === null
        ? null
        : Math.max(
            0,
            Math.round((segment.startedAtMs - callStartedAtMs) / 1000),
          );
    const gapSeconds =
      segment.startedAtMs === undefined || previousStampMs === null
        ? null
        : Math.round((segment.startedAtMs - previousStampMs) / 1000);

    rows.push({
      segment,
      offsetSeconds,
      silenceSeconds:
        gapSeconds !== null && gapSeconds >= SILENCE_THRESHOLD_SECONDS
          ? gapSeconds
          : null,
      callStart: startsCall,
      callStartedAtMs,
    });
    if (segment.startedAtMs !== undefined)
      previousStampMs = segment.startedAtMs;
  }

  let pendingStart: number | null = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.callStartedAtMs !== null) pendingStart = row.callStartedAtMs;
    else rows[index] = { ...row, callStartedAtMs: pendingStart };
    if (row.callStart) pendingStart = null;
  }

  return rows;
}

function formatTimelineOffset(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60) % 60;
  const hours = Math.floor(safe / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(safe % 60)}`
    : `${pad(minutes)}:${pad(safe % 60)}`;
}

function CallHeader({ startedAtMs }: { startedAtMs: number | null }) {
  const locale = useMockLocale();
  const t = useMockT();
  if (startedAtMs === null) return null;

  const time = new Date(startedAtMs).toLocaleTimeString(
    locale === "zh" ? "zh-CN" : "en-US",
    {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    },
  );

  return (
    <div className="mb-2 flex items-center gap-2 pl-[3.25rem] text-xs text-muted-foreground/80">
      <span>{t("chat.realtimeVoice.callStartedAt", { time })}</span>
      <span className="h-px flex-1 bg-border/60" aria-hidden />
    </div>
  );
}

function SilenceMarker({ seconds }: { seconds: number }) {
  const t = useMockT();

  return (
    <div className="grid grid-cols-[3rem_1rem_minmax(0,1fr)] items-center">
      <span />
      <span
        className="mx-auto h-4 w-px border-l border-dashed border-border"
        aria-hidden
      />
      <span className="pl-2 text-xs text-muted-foreground/70 tabular-nums">
        {t("chat.realtimeVoice.silence", {
          duration: formatTimelineOffset(seconds),
        })}
      </span>
    </div>
  );
}

function TimelineRow({
  row,
  speaking,
  first,
  last,
}: {
  row: RealtimeTimelineRowMock;
  speaking: boolean;
  first: boolean;
  last: boolean;
}) {
  const t = useMockT();
  const assistant = row.segment.role === "assistant";

  return (
    <div className="grid grid-cols-[3rem_1rem_minmax(0,1fr)] items-start">
      <span className="pt-1.5 pr-2 text-right font-mono text-xs text-muted-foreground/80 tabular-nums">
        {row.offsetSeconds === null
          ? ""
          : formatTimelineOffset(row.offsetSeconds)}
      </span>

      <span
        className="relative flex flex-col items-center self-stretch"
        aria-hidden
      >
        <span
          className={cn(
            "h-3 w-px shrink-0",
            first ? "bg-transparent" : "bg-border",
          )}
        />
        <span
          className={cn("w-px flex-1", last ? "bg-transparent" : "bg-border")}
        />
        <span
          className={cn(
            "absolute top-[9px] size-1.5 rounded-full ring-2 ring-background",
            speaking
              ? "size-2 animate-pulse bg-primary"
              : assistant
                ? "bg-primary/60"
                : "bg-muted-foreground/50",
          )}
        />
      </span>

      <div className="mb-1.5 min-w-0 rounded-md border border-border/60 bg-card px-2.5 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {assistant ? "Codex" : t("chat.realtimeVoice.speakerUser")}
          {speaking && (
            <span className="ml-1.5 text-primary">
              {t("chat.realtimeVoice.speaking")}
            </span>
          )}
        </span>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {row.segment.text}
        </p>
      </div>
    </div>
  );
}

export interface CodexRealtimeTimelineMockProps {
  segments?: readonly RealtimeTimelineSegmentMock[];
  speakingSegmentIds?: readonly string[];
  className?: string;
}

export function CodexRealtimeTimelineMock({
  segments = DEFAULT_REALTIME_TIMELINE_SEGMENTS,
  speakingSegmentIds = [],
  className,
}: CodexRealtimeTimelineMockProps) {
  const rows = useMemo(() => buildRealtimeTimelineRows(segments), [segments]);
  const speakingIds = useMemo(
    () => new Set(speakingSegmentIds),
    [speakingSegmentIds],
  );

  return (
    <div className={cn("flex flex-col", className)}>
      {rows.map((row, index) => (
        <div key={row.segment.id}>
          {row.callStart && <CallHeader startedAtMs={row.callStartedAtMs} />}
          {row.silenceSeconds !== null && (
            <SilenceMarker seconds={row.silenceSeconds} />
          )}
          <TimelineRow
            row={row}
            speaking={speakingIds.has(row.segment.id)}
            first={index === 0}
            last={index === rows.length - 1}
          />
        </div>
      ))}
    </div>
  );
}

export interface CodexConversationThreadMockProps {
  messages?: readonly RealtimeThreadMessageMock[];
  className?: string;
}

export function CodexConversationThreadMock({
  messages = DEFAULT_REALTIME_THREAD_MESSAGES,
  className,
}: CodexConversationThreadMockProps) {
  const t = useMockT();

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {messages.map((message) => {
        const user = message.role === "user";
        return (
          <article
            key={message.id}
            className={cn("flex min-w-0 flex-col gap-1", user && "items-end")}
          >
            <span className="text-xs font-medium text-muted-foreground">
              {user ? t("chat.realtimeVoice.speakerUser") : "Codex"}
            </span>
            <p
              className={cn(
                "max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap",
                user && "rounded-xl bg-muted px-3 py-2",
              )}
            >
              {message.text}
            </p>
          </article>
        );
      })}
    </div>
  );
}

export interface RealtimeVoiceMockProps {
  view?: CodexConversationView;
  defaultView?: CodexConversationView;
  voiceState?: RealtimeVoiceState;
  defaultVoiceState?: RealtimeVoiceState;
  hasTimeline?: boolean;
  segments?: readonly RealtimeTimelineSegmentMock[];
  speakingSegmentIds?: readonly string[];
  threadMessages?: readonly RealtimeThreadMessageMock[];
  disabled?: boolean;
  composerContent?: ReactNode;
  className?: string;
  onViewChange?: (view: CodexConversationView) => void;
  onVoiceStateChange?: (state: RealtimeVoiceState) => void;
}

export function RealtimeVoiceMock({
  view,
  defaultView = "thread",
  voiceState,
  defaultVoiceState = "idle",
  hasTimeline,
  segments = DEFAULT_REALTIME_TIMELINE_SEGMENTS,
  speakingSegmentIds = [],
  threadMessages = DEFAULT_REALTIME_THREAD_MESSAGES,
  disabled = false,
  composerContent,
  className,
  onViewChange,
  onVoiceStateChange,
}: RealtimeVoiceMockProps) {
  const t = useMockT();
  const [currentView, setCurrentView] = useControllableValue({
    value: view,
    defaultValue: defaultView,
    onChange: onViewChange,
  });
  const [currentVoiceState, setCurrentVoiceState] = useControllableValue({
    value: voiceState,
    defaultValue: defaultVoiceState,
    onChange: onVoiceStateChange,
  });
  const timelineAvailable = hasTimeline ?? segments.length > 0;
  const live =
    currentVoiceState === "starting" || currentVoiceState === "active";

  const handleVoiceStateChange = (next: RealtimeVoiceState) => {
    setCurrentVoiceState(next);
    if (next === "active") setCurrentView("realtime");
  };

  return (
    <section
      className={cn(
        "flex min-h-[34rem] w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
      aria-label={t("chat.realtimeVoice.listening")}
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 rounded-full bg-primary" aria-hidden />
          <span className="truncate text-sm font-medium">Codex</span>
        </div>
        <CodexConversationViewToggleMock
          view={currentView}
          hasTimeline={timelineAvailable}
          onViewChange={setCurrentView}
        />
      </header>

      <ScrollArea className="min-h-0 flex-1 bg-background/40">
        <div className="mx-auto w-full max-w-3xl p-4">
          {currentView === "realtime" ? (
            segments.length > 0 ? (
              <CodexRealtimeTimelineMock
                segments={segments}
                speakingSegmentIds={speakingSegmentIds}
              />
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {t(
                  live
                    ? "chat.realtimeVoice.waiting"
                    : "chat.realtimeVoice.emptyTimeline",
                )}
              </p>
            )
          ) : threadMessages.length > 0 ? (
            <CodexConversationThreadMock messages={threadMessages} />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {t("chat.realtimeVoice.emptyTimeline")}
            </p>
          )}
        </div>
      </ScrollArea>

      <footer className="flex shrink-0 items-end gap-2 border-t border-border bg-card p-3">
        <div className="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
          {composerContent ?? t("chat.placeholder.codexAsk")}
        </div>
        <CodexRealtimeVoiceButtonMock
          state={currentVoiceState}
          disabled={disabled}
          onStateChange={handleVoiceStateChange}
        />
      </footer>
    </section>
  );
}
