import type { McpUiStyles } from '@modelcontextprotocol/ext-apps/app-bridge'

export interface McpAppStyleOverrides {
  colors?: {
    background?: string
    foreground?: string
    muted?: string
    mutedForeground?: string
    border?: string
    primary?: string
    primaryForeground?: string
    destructive?: string
  }
  fontFamily?: string
  monoFontFamily?: string
  radius?: string
}

const TYPOGRAPHY_AND_SHAPE = {
  '--font-sans': 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  '--font-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  '--font-weight-normal': '400',
  '--font-weight-medium': '500',
  '--font-weight-semibold': '600',
  '--font-weight-bold': '700',
  '--font-text-xs-size': '0.75rem',
  '--font-text-sm-size': '0.875rem',
  '--font-text-md-size': '1rem',
  '--font-text-lg-size': '1.125rem',
  '--font-heading-xs-size': '0.875rem',
  '--font-heading-sm-size': '1rem',
  '--font-heading-md-size': '1.125rem',
  '--font-heading-lg-size': '1.25rem',
  '--font-heading-xl-size': '1.5rem',
  '--font-heading-2xl-size': '1.875rem',
  '--font-heading-3xl-size': '2.25rem',
  '--font-text-xs-line-height': '1rem',
  '--font-text-sm-line-height': '1.25rem',
  '--font-text-md-line-height': '1.5rem',
  '--font-text-lg-line-height': '1.75rem',
  '--font-heading-xs-line-height': '1.25rem',
  '--font-heading-sm-line-height': '1.375rem',
  '--font-heading-md-line-height': '1.5rem',
  '--font-heading-lg-line-height': '1.75rem',
  '--font-heading-xl-line-height': '2rem',
  '--font-heading-2xl-line-height': '2.25rem',
  '--font-heading-3xl-line-height': '2.5rem',
  '--border-radius-xs': '0.125rem',
  '--border-radius-sm': '0.25rem',
  '--border-radius-md': '0.375rem',
  '--border-radius-lg': '0.5rem',
  '--border-radius-xl': '0.75rem',
  '--border-radius-full': '9999px',
  '--border-width-regular': '1px',
} as const

export const MCP_APP_LIGHT_STYLE_VARIABLES: McpUiStyles = {
  ...TYPOGRAPHY_AND_SHAPE,
  '--color-background-primary': '#ffffff',
  '--color-background-secondary': '#f4f4f5',
  '--color-background-tertiary': '#e4e4e7',
  '--color-background-inverse': '#18181b',
  '--color-background-ghost': 'transparent',
  '--color-background-info': '#eff6ff',
  '--color-background-danger': '#fef2f2',
  '--color-background-success': '#f0fdf4',
  '--color-background-warning': '#fffbeb',
  '--color-background-disabled': '#f4f4f5',
  '--color-text-primary': '#09090b',
  '--color-text-secondary': '#71717a',
  '--color-text-tertiary': '#a1a1aa',
  '--color-text-inverse': '#fafafa',
  '--color-text-ghost': '#71717a',
  '--color-text-info': '#1d4ed8',
  '--color-text-danger': '#dc2626',
  '--color-text-success': '#15803d',
  '--color-text-warning': '#b45309',
  '--color-text-disabled': '#a1a1aa',
  '--color-border-primary': '#e4e4e7',
  '--color-border-secondary': '#f4f4f5',
  '--color-border-tertiary': '#d4d4d8',
  '--color-border-inverse': '#27272a',
  '--color-border-ghost': 'transparent',
  '--color-border-info': '#93c5fd',
  '--color-border-danger': '#fca5a5',
  '--color-border-success': '#86efac',
  '--color-border-warning': '#fcd34d',
  '--color-border-disabled': '#e4e4e7',
  '--color-ring-primary': '#18181b',
  '--color-ring-secondary': '#71717a',
  '--color-ring-inverse': '#fafafa',
  '--color-ring-info': '#2563eb',
  '--color-ring-danger': '#dc2626',
  '--color-ring-success': '#16a34a',
  '--color-ring-warning': '#d97706',
  '--shadow-hairline': '0 0 0 1px rgba(9, 9, 11, 0.06)',
  '--shadow-sm': '0 1px 2px 0 rgba(9, 9, 11, 0.05)',
  '--shadow-md': '0 4px 6px -1px rgba(9, 9, 11, 0.1), 0 2px 4px -2px rgba(9, 9, 11, 0.1)',
  '--shadow-lg': '0 10px 15px -3px rgba(9, 9, 11, 0.1), 0 4px 6px -4px rgba(9, 9, 11, 0.1)',
}

export const MCP_APP_DARK_STYLE_VARIABLES: McpUiStyles = {
  ...TYPOGRAPHY_AND_SHAPE,
  '--color-background-primary': '#09090b',
  '--color-background-secondary': '#18181b',
  '--color-background-tertiary': '#27272a',
  '--color-background-inverse': '#fafafa',
  '--color-background-ghost': 'transparent',
  '--color-background-info': '#172554',
  '--color-background-danger': '#450a0a',
  '--color-background-success': '#052e16',
  '--color-background-warning': '#451a03',
  '--color-background-disabled': '#18181b',
  '--color-text-primary': '#fafafa',
  '--color-text-secondary': '#a1a1aa',
  '--color-text-tertiary': '#71717a',
  '--color-text-inverse': '#09090b',
  '--color-text-ghost': '#a1a1aa',
  '--color-text-info': '#93c5fd',
  '--color-text-danger': '#f87171',
  '--color-text-success': '#4ade80',
  '--color-text-warning': '#fbbf24',
  '--color-text-disabled': '#52525b',
  '--color-border-primary': '#27272a',
  '--color-border-secondary': '#18181b',
  '--color-border-tertiary': '#3f3f46',
  '--color-border-inverse': '#e4e4e7',
  '--color-border-ghost': 'transparent',
  '--color-border-info': '#1e40af',
  '--color-border-danger': '#991b1b',
  '--color-border-success': '#166534',
  '--color-border-warning': '#92400e',
  '--color-border-disabled': '#27272a',
  '--color-ring-primary': '#d4d4d8',
  '--color-ring-secondary': '#71717a',
  '--color-ring-inverse': '#18181b',
  '--color-ring-info': '#3b82f6',
  '--color-ring-danger': '#ef4444',
  '--color-ring-success': '#22c55e',
  '--color-ring-warning': '#f59e0b',
  '--shadow-hairline': '0 0 0 1px rgba(255, 255, 255, 0.08)',
  '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.35)',
  '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.45), 0 2px 4px -2px rgba(0, 0, 0, 0.35)',
  '--shadow-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.4)',
}

const COLOR_OVERRIDE_MAP = {
  background: '--color-background-primary',
  foreground: '--color-text-primary',
  muted: '--color-background-secondary',
  mutedForeground: '--color-text-secondary',
  border: '--color-border-primary',
  primary: '--color-background-info',
  primaryForeground: '--color-text-inverse',
  destructive: '--color-text-danger',
} as const

export function mcpAppHostStyleVariables(theme: 'light' | 'dark', overrides: McpAppStyleOverrides = {}): McpUiStyles {
  const variables: McpUiStyles = { ...(theme === 'dark' ? MCP_APP_DARK_STYLE_VARIABLES : MCP_APP_LIGHT_STYLE_VARIABLES) }
  for (const [key, variable] of Object.entries(COLOR_OVERRIDE_MAP)) {
    const value = overrides.colors?.[key as keyof typeof COLOR_OVERRIDE_MAP]
    if (value) variables[variable] = value
  }
  if (overrides.fontFamily) variables['--font-sans'] = overrides.fontFamily
  if (overrides.monoFontFamily) variables['--font-mono'] = overrides.monoFontFamily
  if (overrides.radius) variables['--border-radius-md'] = overrides.radius
  return variables
}
