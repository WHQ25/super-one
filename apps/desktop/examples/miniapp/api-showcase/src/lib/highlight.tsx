import type { ReactNode } from 'react'

// Minimal, dependency-free JS/TS/JSX tokenizer. A single sticky-regex scan
// (not line-based) so multi-line template literals stay one string token.
type Kind = 'comment' | 'keyword' | 'string' | 'number' | 'fn' | 'tag' | null

const KEYWORDS =
  'const|let|var|function|return|if|else|for|while|do|await|async|new|import|from|export|default|typeof|instanceof|in|of|true|false|null|undefined|void|class|extends|implements|try|catch|finally|throw|switch|case|break|continue|this|interface|type|as|yield|delete'

const RULES: Array<[RegExp, Kind]> = [
  [/\s+/y, null],
  [/\/\/[^\n]*/y, 'comment'],
  [/\/\*[\s\S]*?\*\//y, 'comment'],
  [/`(?:\\[\s\S]|[^`\\])*`/y, 'string'],
  [/'(?:\\.|[^'\\\n])*'/y, 'string'],
  [/"(?:\\.|[^"\\\n])*"/y, 'string'],
  [/\b\d[\w.]*/y, 'number'],
  [/=>/y, 'keyword'],
  [new RegExp(`(?:${KEYWORDS})\\b`, 'y'), 'keyword'],
  [/<\/?[A-Za-z][\w.]*|\/?>/y, 'tag'],
  [/[A-Za-z_$][\w$]*(?=\s*\()/y, 'fn'],
  [/[A-Za-z_$][\w$]*/y, null],
  [/[\s\S]/y, null],
]

const COLOR: Record<Exclude<Kind, null>, string> = {
  comment: 'var(--hl-comment)',
  keyword: 'var(--hl-keyword)',
  string: 'var(--hl-string)',
  number: 'var(--hl-number)',
  fn: 'var(--hl-fn)',
  tag: 'var(--hl-tag)',
}

export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < code.length) {
    let matched = false
    for (const [re, kind] of RULES) {
      re.lastIndex = i
      const m = re.exec(code)
      if (m && m.index === i && m[0].length > 0) {
        const text = m[0]
        if (kind) {
          out.push(
            <span key={key++} style={{ color: COLOR[kind] }}>
              {text}
            </span>,
          )
        } else {
          out.push(text)
        }
        i += text.length
        matched = true
        break
      }
    }
    if (!matched) {
      out.push(code[i])
      i += 1
    }
  }
  return out
}
