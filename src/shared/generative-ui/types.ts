export interface WidgetData {
  title: string
  widget_code: string
  width: number
  height: number
  isSVG: boolean
}

export function parseWidgetData(params: Record<string, unknown>): WidgetData | null {
  const code = params.widget_code
  if (typeof code !== 'string' || !code) return null
  return {
    title: String(params.title ?? 'widget'),
    widget_code: code,
    width: Number(params.width) || 800,
    height: Number(params.height) || 600,
    isSVG: code.trimStart().startsWith('<svg'),
  }
}

export function parseWidgetResult(text: string): WidgetData | null {
  try {
    return parseWidgetData(JSON.parse(text))
  } catch {}
  return null
}

function extractJsonStringValue(json: string, key: string): string | undefined {
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

function extractJsonNumberValue(json: string, key: string): number | undefined {
  const match = json.match(new RegExp(`"${key}":\\s*(\\d+)`))
  return match ? Number(match[1]) : undefined
}

export function parsePartialWidgetInput(partialJson: string): WidgetData | null {
  const code = extractJsonStringValue(partialJson, 'widget_code')
  if (!code) return null
  return {
    title: extractJsonStringValue(partialJson, 'title') ?? 'widget',
    widget_code: code,
    width: extractJsonNumberValue(partialJson, 'width') ?? 800,
    height: extractJsonNumberValue(partialJson, 'height') ?? 600,
    isSVG: code.trimStart().startsWith('<svg'),
  }
}
