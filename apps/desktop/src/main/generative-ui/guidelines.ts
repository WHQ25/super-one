import preamble from './guidelines/sections/preamble.md?raw'
import modules from './guidelines/sections/modules.md?raw'
import coreDesignSystem from './guidelines/sections/core_design_system.md?raw'
import whenNothingFits from './guidelines/sections/when_nothing_fits.md?raw'
import colorPalette from './guidelines/sections/color_palette.md?raw'
import svgSetup from './guidelines/sections/svg_setup.md?raw'
import diagramTypes from './guidelines/sections/diagram_types.md?raw'
import uiComponents from './guidelines/sections/ui_components.md?raw'
import chartsChartJs from './guidelines/sections/charts_chart_js.md?raw'
import artAndIllustration from './guidelines/sections/art_and_illustration.md?raw'
import mapping from './guidelines/sections/mapping.json'
import { WIDGET_GUIDELINE_MODULES } from './guideline-modules'

const SECTION_MAP: Record<string, string> = {
  '_preamble': preamble,
  'Modules': modules,
  'Core Design System': coreDesignSystem,
  'When nothing fits': whenNothingFits,
  'Color palette': colorPalette,
  'SVG setup': svgSetup,
  'Diagram types': diagramTypes,
  'UI components': uiComponents,
  'Charts (Chart.js)': chartsChartJs,
  'Art and illustration': artAndIllustration,
}

export const AVAILABLE_MODULES = WIDGET_GUIDELINE_MODULES

export function getGuidelines(requestedModules: string[]): string {
  const seen = new Set<string>()
  const parts: string[] = []

  for (const mod of requestedModules) {
    const sections = (mapping as Record<string, string[]>)[mod]
    if (!sections) continue
    for (const section of sections) {
      if (seen.has(section)) continue
      seen.add(section)
      const content = SECTION_MAP[section]
      if (content) parts.push(content)
    }
  }

  return parts.join('\n\n')
}
