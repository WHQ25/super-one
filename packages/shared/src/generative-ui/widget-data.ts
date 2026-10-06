import { parsePartialWidgetInput, parseWidgetLayout, parseWidgetResult, type WidgetData, type WidgetLayout, type WidgetReusableHint } from './types'

/** `widget_show` arguments, read the same way by the host that runs a call and a surface that redraws it. */
export interface WidgetShowArgs {
  title: string
  widget_code?: string
  template?: string
  data?: Record<string, unknown>
  reusable?: WidgetReusableHint
  /** Overrides the layout a reused template was saved with. */
  layout?: WidgetLayout
  width?: number
  height?: number
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function readWidgetShowArgs(args: Record<string, unknown>): WidgetShowArgs {
  return {
    title: String(args.title ?? ''),
    widget_code: typeof args.widget_code === 'string' ? args.widget_code : undefined,
    template: typeof args.template === 'string' ? args.template : undefined,
    data: asRecord(args.data),
    reusable: asRecord(args.reusable) as WidgetReusableHint | undefined,
    layout: parseWidgetLayout(args.layout),
    width: typeof args.width === 'number' ? args.width : undefined,
    height: typeof args.height === 'number' ? args.height : undefined,
  }
}

const DATA_PRELUDE_START = '<script>window.widget=Object.assign(window.widget||{},{data:'
const DATA_PRELUDE_END = '})</script>'

export function injectWidgetData(code: string, data?: Record<string, unknown>): string {
  if (!data) return code
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return `${DATA_PRELUDE_START}${json}${DATA_PRELUDE_END}${code}`
}

/**
 * The widget's own source: `code` without the leading preludes `injectWidgetData` wrote,
 * which a rendered widget carries and a template must not store, or its old data would
 * overwrite the data of every later render. Only the exact form `injectWidgetData` writes
 * for a record is removed; any other script stays. The data escapes `<`, so a prelude
 * ends at its first `</script>`.
 */
export function stripInjectedWidgetData(code: string): string {
  let rest = code
  while (rest.startsWith(DATA_PRELUDE_START)) {
    const end = rest.indexOf('</script>') + '</script>'.length
    const prelude = rest.slice(0, end)
    if (!prelude.endsWith(DATA_PRELUDE_END)) break
    let data: Record<string, unknown> | undefined
    try {
      data = asRecord(JSON.parse(prelude.slice(DATA_PRELUDE_START.length, -DATA_PRELUDE_END.length)))
    } catch {
      break
    }
    if (!data || injectWidgetData('', data) !== prelude) break
    rest = rest.slice(end)
  }
  return rest
}

export interface WidgetDataSource extends Omit<WidgetShowArgs, 'widget_code' | 'template'> {
  /** The widget's own code: the call's `widget_code`, or a saved template's source. */
  source: string
  templateId?: string
  templateVersion?: number
}

/** The payload a call renders. The one place it is assembled, so every reader draws the same widget. */
export function buildWidgetData(input: WidgetDataSource): WidgetData {
  const { title, source, data, reusable, layout, width, height, templateId, templateVersion } = input
  return {
    title,
    widget_code: injectWidgetData(source, data),
    width: width ?? 800,
    height: height ?? 600,
    isSVG: source.trimStart().startsWith('<svg'),
    ...(layout ? { layout } : {}),
    ...(templateId ? { templateId, templateVersion } : {}),
    ...(reusable ? { reusable } : {}),
  }
}

/**
 * The payload of a `widget_code` call, rebuilt from its complete input exactly as the host
 * built it. `null` for a template call (its code lives in the template store) or an input
 * without code.
 */
export function widgetDataFromInput(input: string | Record<string, unknown>): WidgetData | null {
  let record: Record<string, unknown> | undefined
  if (typeof input === 'string') {
    try { record = asRecord(JSON.parse(input)) } catch { return null }
  } else {
    record = input
  }
  if (!record) return null
  const { widget_code, template, ...args } = readWidgetShowArgs(record)
  if (!widget_code || template) return null
  return buildWidgetData({ ...args, source: widget_code })
}

/**
 * The widget a `widget_show` call draws on desktop and phone. A result that carries the
 * payload wins: older transcripts, template calls, and harnesses that keep the full result.
 * Otherwise the payload is rebuilt from the call's complete input, also for a call sealed
 * without a result: its widget was already on screen once the input was complete. A partial
 * input is only a preview while the call runs. Callers rule out failed and denied calls first.
 */
export function resolveWidgetCall(input: string, result: string | undefined, settled: boolean): WidgetData | null {
  const fromResult = result ? parseWidgetResult(result) : null
  if (fromResult) return fromResult
  return widgetDataFromInput(input) ?? (settled ? null : parsePartialWidgetInput(input))
}
