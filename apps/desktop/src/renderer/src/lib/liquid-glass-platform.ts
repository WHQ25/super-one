type GlassHost = {
  supportsLiquidGlass?: boolean
  platform?: string
} | null | undefined

/** Whether the renderer should apply the translucent `.liquid-glass` surfaces. */
export function shouldApplyLiquidGlassClass(liquidGlass: boolean, app?: GlassHost): boolean {
  if (!liquidGlass) return false
  if (!app) return true
  if (typeof app.supportsLiquidGlass === 'boolean') return app.supportsLiquidGlass
  return app.platform === 'darwin'
}
