import { setChatViewLocale } from './i18n'
import type { HostInbound } from './protocol'

export type DocumentViewport = Omit<Extract<HostInbound, { type: 'setViewport' }>, 'type'>

/** Stamp the host's safe area, text scale and locale onto the document. */
export function applyDocumentViewport(viewport: DocumentViewport): void {
  const root = document.documentElement
  if (viewport.safeArea) {
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const value = viewport.safeArea[edge] ?? 0
      root.style.setProperty(`--safe-area-${edge}`, `${Math.max(0, value)}px`)
    }
  }
  if (typeof viewport.fontScale === 'number') {
    root.style.fontSize = `${Math.max(0.8, Math.min(1.6, viewport.fontScale)) * 16}px`
  }
  if (viewport.locale) {
    root.lang = viewport.locale
    void setChatViewLocale(viewport.locale)
  }
}
