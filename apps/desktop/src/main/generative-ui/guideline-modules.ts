export const WIDGET_GUIDELINE_MODULES = [
  'diagram',
  'mockup',
  'interactive',
  'chart',
  'art',
] as const

export type WidgetGuidelineModule = (typeof WIDGET_GUIDELINE_MODULES)[number]
