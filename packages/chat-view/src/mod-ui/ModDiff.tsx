/**
 * A mod's `Code` with `format: 'diff'`: unified hunks drawn with line numbers
 * in place of the `@@` headers, as Claude Code draws them.
 */
interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'gap'
  oldNo?: number
  newNo?: number
  text: string
}

export function parseHunks(source: string): DiffLine[] {
  const out: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  for (const raw of source.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (header) {
      if (out.length > 0) out.push({ kind: 'gap', text: '…' })
      oldNo = Number(header[1])
      newNo = Number(header[2])
      continue
    }
    if (raw.startsWith('+')) out.push({ kind: 'add', newNo: newNo++, text: raw.slice(1) })
    else if (raw.startsWith('-')) out.push({ kind: 'del', oldNo: oldNo++, text: raw.slice(1) })
    else if (raw.startsWith('\\')) continue
    else out.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: raw.startsWith(' ') ? raw.slice(1) : raw })
  }
  return out
}

const ROW: Record<DiffLine['kind'], string> = {
  add: 'bg-[color-mix(in_srgb,var(--mod-green,#30a46c)_16%,transparent)]',
  del: 'bg-[color-mix(in_srgb,var(--mod-red,#e5484d)_16%,transparent)]',
  ctx: '',
  gap: 'text-muted-foreground',
}

export function ModDiff({ source, wrap }: { source: string; wrap?: 'wrap' | 'truncate-end' }) {
  const lines = parseHunks(source)
  return (
    <div className="min-w-0 overflow-x-auto rounded-md border border-border/60 font-mono text-xs leading-[var(--mod-row,1.5em)]">
      {lines.map((line, i) => (
        <div key={i} className={`flex min-w-0 ${ROW[line.kind]}`}>
          <span className="w-[5ch] shrink-0 select-none pr-[1ch] text-right text-muted-foreground">{line.kind === 'add' ? '' : (line.oldNo ?? '')}</span>
          <span className="w-[5ch] shrink-0 select-none pr-[1ch] text-right text-muted-foreground">{line.kind === 'del' ? '' : (line.newNo ?? '')}</span>
          <span className="w-[2ch] shrink-0 select-none text-muted-foreground">{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
          <span className={wrap === 'wrap' ? 'min-w-0 whitespace-pre-wrap break-all' : 'min-w-0 truncate whitespace-pre'}>{line.text}</span>
        </div>
      ))}
    </div>
  )
}
