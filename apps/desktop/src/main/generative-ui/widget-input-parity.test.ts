import { describe, expect, it } from 'vitest'
import { readWidgetShowArgs, widgetDataFromInput } from '@superone/shared/generative-ui/widget-data'
import { buildWidgetPayload } from './widget-payload'

// Surfaces redraw a `widget_code` call from its input. That is only sound while the
// payload they rebuild is byte for byte the one the host returned for the same call.
const roots = { project: undefined, user: '/nonexistent-widget-templates' }

const calls: Record<string, Record<string, unknown>> = {
  'bare html': { title: 'chart', widget_code: '<div>chart</div>' },
  'html with data': { title: 'panel', widget_code: '<div id="p"></div>', data: { clips: 3, label: '</script>' } },
  'svg with sizes': { title: 'diagram', widget_code: '\n<svg viewBox="0 0 10 10"></svg>', width: 640, height: 320 },
  'fixed layout': { title: 'mockup', widget_code: '<main/>', layout: 'fixed' },
  'reusable hint': { title: 'card', widget_code: '<div/>', reusable: { id: 'card', description: 'A card', inputSchema: { type: 'object' } } },
  'malformed optional fields': { title: 7, widget_code: '<div/>', data: [1], layout: 'wide', width: '9', reusable: 'x' },
}

describe('a widget rebuilt from its input', () => {
  for (const [name, args] of Object.entries(calls)) {
    it(`matches the host payload: ${name}`, () => {
      const hosted = buildWidgetPayload(roots, readWidgetShowArgs(args)).payload
      expect(hosted).toBeDefined()
      expect(JSON.stringify(widgetDataFromInput(JSON.stringify(args)))).toBe(JSON.stringify(hosted))
    })
  }
})
