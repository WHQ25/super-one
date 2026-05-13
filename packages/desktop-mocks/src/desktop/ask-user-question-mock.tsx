"use client"

import { type ReactNode } from "react"
import { Button } from "@superone/ui/components/ui/button"
import { Kbd } from "@superone/ui/components/ui/kbd"
import { cn } from "@superone/ui/lib/utils"
import { MockMarkdown } from "./mock-markdown"

export interface MockQuestionOption {
  label: string
  description?: string
  preview?: string
}

export interface MockUserQuestion {
  header: string
  question: string
  multiSelect?: boolean
  options: MockQuestionOption[]
}

export interface AskUserQuestionMockProps {
  questions: MockUserQuestion[]
  activeTabIndex?: number
  selections?: Record<string, string>
  otherTexts?: Record<string, string>
  noteText?: string
  feedbackFocused?: boolean
  className?: string
}

export function AskUserQuestionMock({
  questions,
  activeTabIndex = 0,
  selections = {},
  otherTexts = {},
  noteText,
  feedbackFocused = false,
  className,
}: AskUserQuestionMockProps) {
  const singleQuestion = questions.length === 1
  const activeQuestion = questions[Math.min(activeTabIndex, questions.length - 1)] ?? questions[0]
  if (!activeQuestion) return null

  const hasPreview = activeQuestion.options.some((o) => !!o.preview)
  const activeKey = activeQuestion.question
  const otherText = otherTexts[activeKey] ?? ""
  const allAnswered = questions.every((q) => {
    const k = q.question
    return !!(selections[k] || otherTexts[k])
  })

  return (
    <div className={cn("@container mx-3 mb-2 rounded-lg border border-primary/40 bg-muted/60 p-3 dark:border-blue-600/40", className)}>
      {!singleQuestion && (
        <div className="mb-3 flex gap-1 border-b border-border/50 pb-2">
          {questions.map((q, i) => {
            const answered = !!(selections[q.question] || otherTexts[q.question])
            const active = i === activeTabIndex
            return (
              <div
                key={q.header}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  active
                    ? "bg-primary/15 text-primary dark:bg-blue-600/15 dark:text-blue-500"
                    : "text-muted-foreground",
                )}
              >
                {q.header}
                {answered && <span className="ml-1 text-[10px] text-green-500">&#10003;</span>}
              </div>
            )
          })}
        </div>
      )}

      {hasPreview ? (
        <PreviewPanel
          q={activeQuestion}
          selection={selections[activeKey]}
          noteText={noteText}
        />
      ) : (
        <SimplePanel
          q={activeQuestion}
          selection={selections[activeKey]}
          otherText={otherText}
        />
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          disabled={!allAnswered}
          className={cn(
            "h-7 cursor-pointer bg-primary px-4 text-xs text-primary-foreground hover:bg-primary/90 dark:bg-blue-600 dark:text-white disabled:opacity-50",
          )}
        >
          Submit
          <Kbd variant="inline" className="ml-1 text-primary-foreground/70 dark:text-white/70">
            ↵
          </Kbd>
        </Button>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {!singleQuestion && (
            <>
              <Kbd>⇥</Kbd>
              <span>switch</span>
              <span className="opacity-40">·</span>
            </>
          )}
          {hasPreview && selections[activeKey] && (
            <>
              <Kbd>n</Kbd>
              <span>note</span>
              <span className="opacity-40">·</span>
            </>
          )}
          {feedbackFocused ? (
            <>
              <Kbd>ctrl</Kbd>+<Kbd>num</Kbd>
              <span>select</span>
            </>
          ) : (
            <>
              <Kbd>num</Kbd>
              <span>select</span>
            </>
          )}
          <span className="opacity-40">·</span>
          <Kbd>esc</Kbd>
          <span>dismiss</span>
        </span>
      </div>
    </div>
  )
}

function OptionButton({
  index,
  option,
  selected,
}: {
  index: number
  option: MockQuestionOption
  selected: boolean
}): ReactNode {
  return (
    <div
      className={cn(
        "rounded px-2 py-1 text-xs text-left whitespace-normal @[420px]:py-1.5",
        selected
          ? "bg-primary text-primary-foreground dark:bg-blue-600 dark:text-white"
          : "bg-muted text-foreground",
      )}
    >
      <Kbd variant="square" className="mr-1.5">
        {index + 1}
      </Kbd>
      {option.label}
    </div>
  )
}

function SimplePanel({
  q,
  selection,
  otherText,
}: {
  q: MockUserQuestion
  selection?: string
  otherText: string
}) {
  const sel = selection ?? ""
  const selectedLabels = q.multiSelect ? sel.split(", ").filter(Boolean) : sel ? [sel] : []
  const description = !q.multiSelect && sel
    ? q.options.find((o) => o.label === sel)?.description
    : undefined

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-foreground">{q.question}</p>
      <div className="flex flex-wrap gap-1.5">
        {q.options.map((opt, i) => (
          <OptionButton
            key={opt.label}
            index={i}
            option={opt}
            selected={selectedLabels.includes(opt.label)}
          />
        ))}
      </div>
      <div className="relative mt-2">
        <Kbd variant="square" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
          {q.options.length + 1}
        </Kbd>
        <div className="flex h-7 w-full items-center rounded bg-muted pl-[30px] pr-2 text-xs text-foreground">
          {otherText || <span className="text-muted-foreground">Other…</span>}
        </div>
      </div>
      {description && (
        <div className="mt-2 border-l-2 border-primary bg-primary/10 px-2.5 py-1.5 text-xs leading-snug text-primary dark:border-blue-500 dark:bg-blue-500/15 dark:text-blue-400">
          {description}
        </div>
      )}
    </div>
  )
}

function PreviewPanel({
  q,
  selection,
  noteText,
}: {
  q: MockUserQuestion
  selection?: string
  noteText?: string
}) {
  const sel = selection ?? q.options[0]?.label ?? ""
  const lastLabel = q.multiSelect ? sel.split(", ").pop() ?? "" : sel
  const previewContent = q.options.find((o) => o.label === lastLabel)?.preview

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-foreground">{q.question}</p>
      <div className="flex flex-col gap-3 @[420px]:flex-row">
        <div className="shrink-0 @[420px]:max-w-[40%]">
          <div className="flex flex-wrap gap-1.5 @[420px]:flex-col">
            {q.options.map((opt, i) => (
              <OptionButton
                key={opt.label}
                index={i}
                option={opt}
                selected={lastLabel === opt.label}
              />
            ))}
          </div>
          <div className="mt-1.5 flex h-7 items-center rounded bg-muted px-2 text-xs text-muted-foreground">
            <Kbd variant="square" className="mr-1.5">
              {q.options.length + 1}
            </Kbd>
            Other…
          </div>
        </div>
        <div className="min-w-0 flex-1">
          {previewContent ? (
            <div className="max-h-64 overflow-y-auto rounded-md border border-border/50 bg-muted/30 p-3 text-xs leading-relaxed text-foreground">
              <MockMarkdown text={previewContent} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border/30 p-3 text-xs text-muted-foreground">
              Select an option to preview
            </div>
          )}
          {previewContent && sel && (
            <div className="relative mt-2">
              <Kbd
                variant="square"
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
              >
                n
              </Kbd>
              <div className="flex h-7 w-full items-center rounded bg-muted pl-[30px] pr-2 text-xs text-foreground">
                {noteText || <span className="text-muted-foreground">Add a note (optional)</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

