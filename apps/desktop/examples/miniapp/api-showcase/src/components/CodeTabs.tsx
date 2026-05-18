import { useState } from 'react'
import { highlight } from '../lib/highlight'

type Lang = 'react' | 'vanilla'

const LABELS: Record<Lang, string> = { react: 'React', vanilla: 'Vanilla JS' }

export function CodeTabs({ react, vanilla }: { react: string; vanilla: string }) {
  const [lang, setLang] = useState<Lang>('react')
  const [copied, setCopied] = useState(false)
  const code = lang === 'react' ? react : vanilla

  const copy = () => {
    // The showcase copy button itself dogfoods superone.clipboard.write.
    window.superone.clipboard.write(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="border border-border rounded-[var(--radius-card)] overflow-hidden bg-card min-w-0 w-full">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <div className="flex gap-1">
          {(['react', 'vanilla'] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors ' +
                (lang === l
                  ? 'bg-primary text-primary-fg'
                  : 'text-muted-fg hover:bg-accent hover:text-accent-fg')
              }
            >
              {LABELS[l]}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          className="px-2 py-1 rounded-md text-xs text-muted-fg hover:bg-accent hover:text-accent-fg"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <pre className="code-scroll overflow-auto max-h-[440px] p-3 text-[12.5px] leading-relaxed m-0">
        <code className="font-mono whitespace-pre">{highlight(code)}</code>
      </pre>
    </div>
  )
}
