export const WIDGET_GUIDELINE_MODULES = [
  'diagram',
  'mockup',
  'interactive',
  'chart',
  'art',
  // Unlike the others, this module is not about authoring a visual — it covers handing data to one
  // of SuperOne's own surfaces (@native/* templates) and writing no markup at all.
  'native',
] as const

export type WidgetGuidelineModule = (typeof WIDGET_GUIDELINE_MODULES)[number]
