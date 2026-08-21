export function extractJsonStringValue(
  json: string,
  key: string,
  opts?: { requireClosed?: boolean },
): string | undefined {
  const re = new RegExp(`"${key}":\\s*"`)
  const match = re.exec(json)
  if (!match) return undefined
  let i = match.index + match[0].length
  const start = i
  while (i < json.length) {
    const c = json.charCodeAt(i)
    if (c === 0x5c /* \ */ || c === 0x22 /* " */) break
    i++
  }
  if (i >= json.length) return opts?.requireClosed ? undefined : json.slice(start)
  if (json.charCodeAt(i) === 0x22 /* " */) return json.slice(start, i)

  const parts: string[] = [json.slice(start, i)]
  while (i < json.length) {
    const ch = json[i]
    if (ch === '"') {
      return parts.join('')
    }
    if (ch === '\\') {
      if (i + 1 >= json.length) {
        parts.push(ch)
        i++
        break
      }
      const next = json[i + 1]
      if (next === '"') { parts.push('"'); i += 2 }
      else if (next === '\\') { parts.push('\\'); i += 2 }
      else if (next === 'n') { parts.push('\n'); i += 2 }
      else if (next === 'r') { parts.push('\r'); i += 2 }
      else if (next === 't') { parts.push('\t'); i += 2 }
      else if (next === '/') { parts.push('/'); i += 2 }
      else if (next === 'u' && i + 5 < json.length) {
        const hex = json.slice(i + 2, i + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) { parts.push(String.fromCharCode(parseInt(hex, 16))); i += 6 }
        else { parts.push(ch); i++ }
      } else { parts.push(ch); i++ }
    } else {
      const runStart = i
      i++
      while (i < json.length && json[i] !== '\\' && json[i] !== '"') i++
      parts.push(json.slice(runStart, i))
    }
  }
  return opts?.requireClosed ? undefined : parts.join('')
}

export function extractJsonNumberValue(json: string, key: string): number | undefined {
  const match = json.match(new RegExp(`"${key}":\\s*(-?\\d+(?:\\.\\d+)?)`))
  return match ? Number(match[1]) : undefined
}
