import type { ContextAttachment } from '@superone/shared/context-attachments'

// The real Bits & Bolts icon: one dark stroke, which must follow the theme rather than vanish in dark mode.
const BITS_AND_BOLTS_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="none" stroke="#27272a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M9.5 4.75h13L29 16l-6.5 11.25h-13L3 16zM13 10.8h6l3 5.2-3 5.2h-6L10 16z"/></svg>')}`

/** An MCP App's model context as the composer shows it, for previews and stories. */
export const previewAppContext: ContextAttachment = {
  id: 'bits-and-bolts-view', title: 'selected view', source: 'Bits & Bolts', icon: BITS_AND_BOLTS_ICON,
  content: 'Bits & Bolts selected view: {"page":"viewer","dirty":false,"part":"part_micro_controller","camera":"custom","zoom":1,"mode":"edges","grid":true,"displayUnits":"mm","dimensionsMm":[108.00000512972474,108.00000512972474,23.700001342408356],"note":"","selection":null}',
}
