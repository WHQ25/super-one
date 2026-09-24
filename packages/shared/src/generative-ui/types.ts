export interface WidgetReusableHint {
  id: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/**
 * How a widget meets a container narrower than it was designed for. `fluid` reflows
 * to whatever width it gets; `fixed` keeps its desktop composition and scales down
 * as a whole, so a UI mockup reads with the same proportions on a phone.
 */
export type WidgetLayout = 'fluid' | 'fixed'

/**
 * An explicit `fluid` is kept rather than folded into "unset": it is how a call
 * overrides a template that was saved as `fixed`.
 */
export function parseWidgetLayout(value: unknown): WidgetLayout | undefined {
  return value === 'fixed' || value === 'fluid' ? value : undefined
}

export interface WidgetData {
  title: string
  widget_code: string
  width: number
  height: number
  isSVG: boolean
  /** Absent means `fluid`. */
  layout?: WidgetLayout
  templateId?: string
  templateVersion?: number
  reusable?: WidgetReusableHint
}

export function parseWidgetData(params: Record<string, unknown>): WidgetData | null {
  const code = params.widget_code
  if (typeof code !== 'string' || !code) return null
  const reusable = params.reusable as WidgetReusableHint | undefined
  const layout = parseWidgetLayout(params.layout)
  return {
    title: String(params.title ?? 'widget'),
    widget_code: code,
    width: Number(params.width) || 800,
    height: Number(params.height) || 600,
    isSVG: typeof params.isSVG === 'boolean' ? params.isSVG : code.trimStart().startsWith('<svg'),
    ...(layout ? { layout } : {}),
    ...(typeof params.templateId === 'string' ? { templateId: params.templateId } : {}),
    ...(typeof params.templateVersion === 'number' ? { templateVersion: params.templateVersion } : {}),
    ...(reusable && typeof reusable.id === 'string' ? { reusable } : {}),
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
  const layout = parseWidgetLayout(extractJsonStringValue(partialJson, 'layout', { requireClosed: true }))
  return {
    title: extractJsonStringValue(partialJson, 'title') ?? 'widget',
    widget_code: code,
    width: extractJsonNumberValue(partialJson, 'width') ?? 800,
    height: extractJsonNumberValue(partialJson, 'height') ?? 600,
    isSVG: code.trimStart().startsWith('<svg'),
    ...(layout ? { layout } : {}),
  }
}
