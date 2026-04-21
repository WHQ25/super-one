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

import { extractJsonStringValue, extractJsonNumberValue } from '../partial-json'

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
