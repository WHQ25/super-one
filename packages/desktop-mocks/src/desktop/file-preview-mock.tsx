"use client"

import { useMemo } from "react"
import { diffLines } from "diff"
import { FileIcon } from "@superone/ui/components/ui/FileIcon"
import { Image as ImageIcon } from "lucide-react"
import { cn } from "@superone/ui/lib/utils"
import { MockMarkdown } from "./mock-markdown"

export type FilePreviewSpec =
  | { kind: "code"; filePath: string; language?: string; code: string; startLine?: number }
  | { kind: "markdown"; filePath: string; content: string }
  | { kind: "image"; filePath: string; src: string; alt?: string }
  | { kind: "diff"; filePath: string; oldText: string; newText: string; startLine?: number }

export interface FilePreviewMockProps {
  spec: FilePreviewSpec
  className?: string
}

export function FilePreviewMock({ spec, className }: FilePreviewMockProps) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden border border-border bg-background", className)}>
      <PreviewHeader filePath={spec.filePath} kind={spec.kind} />
      <div className="min-h-0 flex-1 overflow-auto">
        {spec.kind === "code" && (
          <CodePreview
            language={spec.language}
            code={spec.code}
            startLine={spec.startLine ?? 1}
          />
        )}
        {spec.kind === "markdown" && <MarkdownPreview content={spec.content} />}
        {spec.kind === "image" && <ImagePreview src={spec.src} alt={spec.alt ?? spec.filePath} />}
        {spec.kind === "diff" && (
          <DiffPreview
            oldText={spec.oldText}
            newText={spec.newText}
            startLine={spec.startLine ?? 1}
          />
        )}
      </div>
    </div>
  )
}

function PreviewHeader({ filePath, kind }: { filePath: string; kind: FilePreviewSpec["kind"] }) {
  const name = filePath.split("/").pop() ?? filePath
  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs">
      <FileIcon name={name} size={14} />
      <span className="min-w-0 truncate font-mono text-foreground">{filePath}</span>
      <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {kind}
      </span>
    </div>
  )
}

function CodePreview({
  language,
  code,
  startLine,
}: {
  language?: string
  code: string
  startLine: number
}) {
  const lines = code.split("\n")
  const gw = Math.max(2, String(startLine + lines.length - 1).length)
  return (
    <div className="font-mono text-[12px] leading-relaxed">
      <div className="flex justify-end border-b border-border bg-muted/30 px-3 py-0.5 text-[10px] text-muted-foreground">
        {language ?? "plain"}
      </div>
      <pre className="overflow-x-auto py-2">
        {lines.map((line, i) => {
          const ln = startLine + i
          return (
            <div key={i} className="grid grid-cols-[auto_1fr] items-baseline">
              <span
                className="select-none px-3 text-right text-muted-foreground/60"
                style={{ width: `calc(${gw}ch + 1.5rem)` }}
              >
                {ln}
              </span>
              <code className="pr-3 text-foreground">{line || " "}</code>
            </div>
          )
        })}
      </pre>
    </div>
  )
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="px-6 py-4 text-sm leading-relaxed text-foreground">
      <MockMarkdown text={content} />
    </div>
  )
}

function ImagePreview({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-muted/20 p-6">
      <figure className="flex flex-col items-center gap-3">
        <div className="rounded-md border border-border bg-background p-2 shadow-sm">
          {src ? (
            <img src={src} alt={alt} className="block max-h-72 max-w-full" />
          ) : (
            <div className="flex size-48 items-center justify-center text-muted-foreground">
              <ImageIcon className="size-10" />
            </div>
          )}
        </div>
        <figcaption className="text-[11px] text-muted-foreground">{alt}</figcaption>
      </figure>
    </div>
  )
}

interface DiffRow {
  kind: "added" | "removed" | "unchanged"
  lineNum: number
  text: string
}

function DiffPreview({
  oldText,
  newText,
  startLine,
}: {
  oldText: string
  newText: string
  startLine: number
}) {
  const rows = useMemo<DiffRow[]>(() => {
    const changes = diffLines(oldText, newText)
    const result: DiffRow[] = []
    let oldLine = startLine
    let newLine = startLine
    for (const change of changes) {
      const lines = change.value.replace(/\n$/, "").split("\n")
      if (change.removed) {
        for (const text of lines) result.push({ kind: "removed", lineNum: oldLine++, text })
      } else if (change.added) {
        for (const text of lines) result.push({ kind: "added", lineNum: newLine++, text })
      } else {
        for (const text of lines) {
          result.push({ kind: "unchanged", lineNum: newLine, text })
          oldLine++
          newLine++
        }
      }
    }
    return result
  }, [oldText, newText, startLine])

  const maxLine = rows.reduce((m, r) => Math.max(m, r.lineNum), 0)
  const gw = Math.max(2, String(maxLine).length)
  const ROW_BG: Record<DiffRow["kind"], string> = {
    added: "bg-green-500/15",
    removed: "bg-red-500/15",
    unchanged: "",
  }
  const MARKER_CLS: Record<DiffRow["kind"], string> = {
    added: "text-green-600/60 dark:text-green-400/60",
    removed: "text-red-600/60 dark:text-red-400/60",
    unchanged: "text-transparent",
  }
  const MARKER: Record<DiffRow["kind"], string> = {
    added: "+",
    removed: "-",
    unchanged: " ",
  }
  return (
    <div className="overflow-auto py-2 text-[12px] font-mono leading-relaxed text-foreground">
      {rows.map((row, i) => (
        <div key={i} className={cn("whitespace-pre pr-3", ROW_BG[row.kind])}>
          <span
            className="sticky left-0 z-10 inline-block select-none bg-background pl-3 pr-1 text-right text-muted-foreground/50"
            style={{ width: `calc(${gw}ch + 1.5rem)` }}
          >
            {row.lineNum}
          </span>
          <span className={cn("mr-1 inline-block w-[1ch] select-none text-center", MARKER_CLS[row.kind])}>
            {MARKER[row.kind]}
          </span>
          {row.text || " "}
        </div>
      ))}
    </div>
  )
}
