import type { WidgetData } from '@superone/shared/generative-ui/types'
import { buildWidgetData, type WidgetShowArgs } from '@superone/shared/generative-ui/widget-data'
import { readTemplate, type TemplateRoots } from './template-store'

export interface BuiltWidgetPayload {
  payload?: WidgetData
  error?: string
}

export function buildWidgetPayload(roots: TemplateRoots, input: WidgetShowArgs): BuiltWidgetPayload {
  const { widget_code, template, ...args } = input

  if (widget_code && template) {
    return { error: 'widget_show accepts either widget_code or template, not both.' }
  }
  if (!widget_code && !template) {
    return { error: 'widget_show requires either widget_code (new widget) or template (reuse a saved one).' }
  }

  if (!template) return { payload: buildWidgetData({ ...args, source: widget_code ?? '' }) }

  const found = readTemplate(roots, template)
  if (!found) {
    return { error: `No widget template named "${template}". Call widget_list_templates to see the available templates.` }
  }
  return {
    payload: buildWidgetData({
      ...args,
      source: found.code,
      layout: args.layout ?? found.layout,
      templateId: found.id,
      templateVersion: found.version,
    }),
  }
}
