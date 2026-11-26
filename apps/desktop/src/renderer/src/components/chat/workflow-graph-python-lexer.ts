import type { FanoutItem } from './workflow-graph'

export function stripPythonComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    const triple = (c === '"' || c === "'") && src[i + 1] === c && src[i + 2] === c
    if (triple) {
      const q = c.repeat(3)
      out += q
      i += 3
      while (i < src.length) {
        if (src[i] === '\\' && i + 1 < src.length) {
          out += src[i]! + src[i + 1]!
          i += 2
          continue
        }
        if (src.startsWith(q, i)) {
          out += q
          i += 3
          break
        }
        out += src[i]!
        i += 1
      }
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      out += q
      i += 1
      while (i < src.length) {
        if (src[i] === '\\' && i + 1 < src.length) {
          out += src[i]! + src[i + 1]!
          i += 2
          continue
        }
        out += src[i]!
        if (src[i] === q || src[i] === '\n') {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    out += c
    i += 1
  }
  return out
}

export function isStringPrefixStart(src: string, i: number): boolean {
  const c = src[i]
  if (c === '"' || c === "'") return true
  if (i > 0 && /[\w]/.test(src[i - 1]!)) return false
  if (/[fFrRbBuU]/.test(c ?? '')) {
    if (src[i + 1] === '"' || src[i + 1] === "'") return true
    if (/[fFrRbBuU]/.test(src[i + 1] ?? '') && (src[i + 2] === '"' || src[i + 2] === "'")) return true
  }
  return false
}

export function skipPythonString(src: string, start: number): number {
  let i = start
  while (i < src.length && /[fFrRbBuU]/.test(src[i]!)) i += 1
  const q = src[i]
  if (q !== '"' && q !== "'") return start
  const isTriple = src[i + 1] === q && src[i + 2] === q
  const quoteLen = isTriple ? 3 : 1
  i += quoteLen
  while (i < src.length) {
    if (src[i] === '\\' && i + 1 < src.length) {
      i += 2
      continue
    }
    if (isTriple) {
      if (src[i] === q && src[i + 1] === q && src[i + 2] === q) return i + 3
    } else if (src[i] === q) {
      return i + 1
    }
    i += 1
  }
  return src.length
}

export function balancedSlice(src: string, openIdx: number): string | null {
  const open = src[openIdx]
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : null
  if (!close) return null
  let depth = 0
  let i = openIdx
  while (i < src.length) {
    if (isStringPrefixStart(src, i)) {
      i = skipPythonString(src, i)
      continue
    }
    const c = src[i]
    if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) return src.slice(openIdx, i + 1)
    }
    i += 1
  }
  return null
}

export function splitTopLevelArgs(src: string): string[] {
  const parts: string[] = []
  let depthParen = 0
  let depthBracket = 0
  let depthBrace = 0
  let inLambdaParams = false
  let start = 0
  let i = 0
  while (i < src.length) {
    if (isStringPrefixStart(src, i)) {
      i = skipPythonString(src, i)
      continue
    }
    const atTop = depthParen === 0 && depthBracket === 0 && depthBrace === 0
    if (
      atTop
      && !inLambdaParams
      && src.startsWith('lambda', i)
      && (i === 0 || !/\w/.test(src[i - 1]!))
      && i + 6 < src.length
      && /[\s:]/.test(src[i + 6]!)
    ) {
      inLambdaParams = true
      i += 6
      continue
    }
    const c = src[i]
    if (c === '(') depthParen += 1
    else if (c === ')') depthParen -= 1
    else if (c === '[') depthBracket += 1
    else if (c === ']') depthBracket -= 1
    else if (c === '{') depthBrace += 1
    else if (c === '}') depthBrace -= 1
    else if (c === ':' && atTop && inLambdaParams) {
      inLambdaParams = false
    } else if (c === ',' && atTop && !inLambdaParams) {
      const part = src.slice(start, i).trim()
      if (part) parts.push(part)
      start = i + 1
    }
    i += 1
  }
  const tail = src.slice(start).trim()
  if (tail) parts.push(tail)
  return parts
}

export function findTopLevelChar(src: string, target: string): number {
  let depthParen = 0
  let depthBracket = 0
  let depthBrace = 0
  let i = 0
  while (i < src.length) {
    if (isStringPrefixStart(src, i)) {
      i = skipPythonString(src, i)
      continue
    }
    const c = src[i]
    if (c === '(') depthParen += 1
    else if (c === ')') depthParen -= 1
    else if (c === '[') depthBracket += 1
    else if (c === ']') depthBracket -= 1
    else if (c === '{') depthBrace += 1
    else if (c === '}') depthBrace -= 1
    else if (c === target && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      return i
    }
    i += 1
  }
  return -1
}

export function splitKeywordArg(arg: string): { key: string; value: string } | null {
  const eq = findTopLevelChar(arg, '=')
  if (eq <= 0 || arg[eq + 1] === '=') return null
  const key = arg.slice(0, eq).trim()
  if (!/^[A-Za-z_]\w*$/.test(key)) return null
  return { key, value: arg.slice(eq + 1).trim() }
}

function unescapePythonString(body: string, isRaw: boolean): string {
  if (isRaw) return body
  return body.replace(/\\(n|t|r|\\|"|')/g, (_, ch: string) => {
    if (ch === 'n') return '\n'
    if (ch === 't') return '\t'
    if (ch === 'r') return '\r'
    return ch
  })
}

function convertFStringToTemplate(body: string): string {
  let out = ''
  let i = 0
  while (i < body.length) {
    const c = body[i]!
    if (c === '{' && body[i + 1] === '{') {
      out += '{'
      i += 2
      continue
    }
    if (c === '}' && body[i + 1] === '}') {
      out += '}'
      i += 2
      continue
    }
    if (c === '{') {
      let depth = 1
      let j = i + 1
      while (j < body.length && depth > 0) {
        if (body[j] === '{') depth += 1
        else if (body[j] === '}') depth -= 1
        j += 1
      }
      if (depth === 0) {
        const expr = body.slice(i + 1, j - 1).replace(/!r|!s|!a|:[^}]*$/, '').trim()
        out += `\${${expr}}`
        i = j
        continue
      }
    }
    out += c
    i += 1
  }
  return out
}

export function parsePythonStringExpr(expr: string, consts?: Map<string, string>): string | undefined {
  const trimmed = expr.trim()
  if (!trimmed) return undefined
  if (consts && /^[A-Za-z_]\w*$/.test(trimmed)) {
    return consts.get(trimmed)
  }
  const m = trimmed.match(/^([fFrRbBuU]{0,2})("""|'''|"|')([\s\S]*)\2$/)
  if (!m) return undefined
  const prefix = (m[1] ?? '').toLowerCase()
  const isF = prefix.includes('f')
  const isRaw = prefix.includes('r')
  const unescaped = unescapePythonString(m[3] ?? '', isRaw)
  if (!isF) return unescaped
  const tpl = convertFStringToTemplate(unescaped)
  if (!consts) return tpl
  return tpl.replace(/\$\{([^}]+)\}/g, (whole, key: string) => consts.get(key.trim()) ?? whole)
}

function parsePythonDictRecord(expr: string): Record<string, string> | undefined {
  const trimmed = expr.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined
  const entries = splitTopLevelArgs(trimmed.slice(1, -1))
  const rec: Record<string, string> = {}
  for (const entry of entries) {
    const colon = findTopLevelChar(entry, ':')
    if (colon < 0) return undefined
    const key = parsePythonStringExpr(entry.slice(0, colon))
    if (key === undefined) return undefined
    const rawVal = entry.slice(colon + 1).trim()
    const strVal = parsePythonStringExpr(rawVal)
    if (strVal !== undefined) {
      rec[key] = strVal
    } else if (/^(?:-?\d+(?:\.\d+)?|True|False)$/.test(rawVal)) {
      rec[key] = rawVal.toLowerCase()
    } else {
      return undefined
    }
  }
  return rec
}

export function parsePythonListItems(expr: string, lists?: Map<string, FanoutItem[]>): FanoutItem[] | undefined {
  const trimmed = expr.trim()
  if (!trimmed) return undefined
  if (lists && /^[A-Za-z_]\w*$/.test(trimmed)) {
    return lists.get(trimmed)
  }
  if (
    !(trimmed.startsWith('[') && trimmed.endsWith(']'))
    && !(trimmed.startsWith('(') && trimmed.endsWith(')'))
  ) {
    return undefined
  }
  const elements = splitTopLevelArgs(trimmed.slice(1, -1))
  if (elements.length === 0) return undefined
  const out: FanoutItem[] = []
  for (const el of elements) {
    const str = parsePythonStringExpr(el)
    if (str !== undefined) {
      out.push(str)
      continue
    }
    const rec = parsePythonDictRecord(el)
    if (rec) {
      out.push(rec)
      continue
    }
    return undefined
  }
  return out
}
