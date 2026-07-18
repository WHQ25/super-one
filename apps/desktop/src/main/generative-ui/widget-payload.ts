import type { WidgetData, WidgetReusableHint } from '@superone/shared/generative-ui/types'
import { readTemplate, type TemplateRoots } from './template-store'

export interface BuildWidgetPayloadInput {
  title: string
  widget_code?: string
  template?: string
  data?: Record<string, unknown>
  reusable?: WidgetReusableHint
  width?: number
  height?: number
}

export interface BuiltWidgetPayload {
  payload?: WidgetData
  error?: string
}

export function injectWidgetData(code: string, data?: Record<string, unknown>): string {
  if (!data) return code
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return `<script>window.widget=Object.assign(window.widget||{},{data:${json}})</script>${code}`
}

export function buildWidgetPayload(roots: TemplateRoots, input: BuildWidgetPayloadInput): BuiltWidgetPayload {
  const { title, widget_code, template, data, reusable, width, height } = input

  if (widget_code && template) {
    return { error: 'widget_show accepts either widget_code or template, not both.' }
  }
  if (!widget_code && !template) {
    return { error: 'widget_show requires either widget_code (new widget) or template (reuse a saved one).' }
  }

  let source = widget_code ?? ''
  let templateId: string | undefined
  let templateVersion: number | undefined

  if (template) {
    const found = readTemplate(roots, template)
    if (!found) {
      return { error: `No widget template named "${template}". Call widget_read_guide to see the available templates.` }
    }
    source = found.code
    templateId = found.id
    templateVersion = found.version
  }

  return {
    payload: {
      title,
      widget_code: injectWidgetData(source, data),
      width: width ?? 800,
      height: height ?? 600,
      isSVG: source.trimStart().startsWith('<svg'),
      ...(templateId ? { templateId, templateVersion } : {}),
      ...(reusable ? { reusable } : {}),
    },
  }
}
