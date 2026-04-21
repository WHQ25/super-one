export function extractJsonStringValue(json: string, key: string): string | undefined {
  const re = new RegExp(`"${key}":\\s*"`)
  const match = re.exec(json)
  if (!match) return undefined
  let i = match.index + match[0].length
  let value = ''
  while (i < json.length) {
    if (json[i] === '\\' && i + 1 < json.length) {
      const next = json[i + 1]
      if (next === '"') { value += '"'; i += 2 }
      else if (next === '\\') { value += '\\'; i += 2 }
      else if (next === 'n') { value += '\n'; i += 2 }
      else if (next === 'r') { value += '\r'; i += 2 }
      else if (next === 't') { value += '\t'; i += 2 }
      else if (next === '/') { value += '/'; i += 2 }
      else if (next === 'u' && i + 5 < json.length) {
        const hex = json.slice(i + 2, i + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) { value += String.fromCharCode(parseInt(hex, 16)); i += 6 }
        else { value += json[i]; i++ }
      }
      else { value += json[i]; i++ }
    } else if (json[i] === '"') {
      return value
    } else {
      value += json[i]
      i++
    }
  }
  return value
}

export function extractJsonNumberValue(json: string, key: string): number | undefined {
  const match = json.match(new RegExp(`"${key}":\\s*(-?\\d+(?:\\.\\d+)?)`))
  return match ? Number(match[1]) : undefined
}
