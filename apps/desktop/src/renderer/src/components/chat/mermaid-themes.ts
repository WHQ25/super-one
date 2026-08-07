/**
 * Built-in Mermaid themes available in mermaid@11.
 * Split into light / dark lists so Appearance can pick per color scheme
 * (same pattern as terminal palettes).
 *
 * Theme ids must match mermaid's `theme` config enum.
 */
export type MermaidScheme = 'light' | 'dark'

/** Mermaid theme id accepted by mermaid.initialize({ theme }). */
export type MermaidThemeId =
  | 'default'
  | 'forest'
  | 'neutral'
  | 'neo'
  | 'redux'
  | 'redux-color'
  | 'dark'
  | 'neo-dark'
  | 'redux-dark'
  | 'redux-dark-color'

export interface MermaidThemeOption {
  id: MermaidThemeId
  name: string
  /** Approximate accent chips for dropdown previews */
  swatch: [string, string, string]
}

export const DEFAULT_LIGHT_MERMAID_THEME_ID: MermaidThemeId = 'default'
export const DEFAULT_DARK_MERMAID_THEME_ID: MermaidThemeId = 'dark'

export const LIGHT_MERMAID_THEMES: MermaidThemeOption[] = [
  { id: 'default', name: 'Default Light', swatch: ['#ECECFF', '#4B4A67', '#9370DB'] },
  { id: 'forest', name: 'Forest', swatch: ['#c0ffc0', '#13540c', '#2b6e1a'] },
  { id: 'neutral', name: 'Neutral', swatch: ['#eee', '#333', '#999'] },
  { id: 'neo', name: 'Neo', swatch: ['#f4f4f5', '#18181b', '#3b82f6'] },
  // redux = monochrome chrome; redux-color cycles multi-hue borders/fills on
  // successive actors/entities (sequence / ER / git), not plain flowchart nodes.
  { id: 'redux', name: 'Redux', swatch: ['#ffffff', '#cccccc', '#28253D'] },
  { id: 'redux-color', name: 'Redux Color', swatch: ['#E879F9', '#2DD4BF', '#FB923C'] },
]

export const DARK_MERMAID_THEMES: MermaidThemeOption[] = [
  { id: 'dark', name: 'Default Dark', swatch: ['#1f2020', '#bbbfc2', '#7075AC'] },
  { id: 'neutral', name: 'Neutral', swatch: ['#2a2a2a', '#d0d0d0', '#888'] },
  { id: 'neo-dark', name: 'Neo Dark', swatch: ['#18181b', '#e4e4e7', '#60a5fa'] },
  { id: 'redux-dark', name: 'Redux', swatch: ['#111113', '#1f2020', '#FFFFFF'] },
  { id: 'redux-dark-color', name: 'Redux Color', swatch: ['#E879F9', '#2DD4BF', '#FB923C'] },
]

const LIGHT_IDS = new Set(LIGHT_MERMAID_THEMES.map((t) => t.id))
const DARK_IDS = new Set(DARK_MERMAID_THEMES.map((t) => t.id))

export function mermaidThemesFor(scheme: MermaidScheme): MermaidThemeOption[] {
  return scheme === 'dark' ? DARK_MERMAID_THEMES : LIGHT_MERMAID_THEMES
}

export function isMermaidThemeId(value: unknown): value is MermaidThemeId {
  return typeof value === 'string'
    && (LIGHT_IDS.has(value as MermaidThemeId) || DARK_IDS.has(value as MermaidThemeId))
}

/** Resolve a stored setting (may be null / unknown) to a valid theme for the scheme. */
export function resolveMermaidThemeId(
  scheme: MermaidScheme,
  stored: string | null | undefined,
): MermaidThemeId {
  const fallback = scheme === 'dark' ? DEFAULT_DARK_MERMAID_THEME_ID : DEFAULT_LIGHT_MERMAID_THEME_ID
  if (!stored) return fallback
  const allowed = scheme === 'dark' ? DARK_IDS : LIGHT_IDS
  return allowed.has(stored as MermaidThemeId) ? (stored as MermaidThemeId) : fallback
}

export function getMermaidThemeOption(
  scheme: MermaidScheme,
  stored: string | null | undefined,
): MermaidThemeOption {
  const id = resolveMermaidThemeId(scheme, stored)
  const list = mermaidThemesFor(scheme)
  return list.find((t) => t.id === id) ?? list[0]!
}

/**
 * Sample used by the Appearance preview.
 * Sequence (not flowchart): redux-color only multi-hues successive actors /
 * entities, so a plain flowchart makes Redux vs Redux Color look identical.
 */
export const MERMAID_PREVIEW_SOURCE = `sequenceDiagram
  participant A as Alice
  participant B as Bob
  participant C as Carol
  A->>B: Hello
  B->>C: Hi
  C-->>A: Hey`
