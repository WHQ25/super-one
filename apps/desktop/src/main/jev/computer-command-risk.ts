import type { RawElement } from './observation'

const HIGH_RISK_COMMAND = /\b(quit|restart|shut down|log out|empty trash|force quit)\b/i
const NAVIGATION_COMMAND = /^(show|hide) (sidebar|toolbar|tab bar|status bar|path bar)$/i

/** Desktop command menus contain lifecycle and system actions, unlike a popup's navigation choices. */
export function computerCommandRisk(label: string): RawElement['riskHint'] {
  if (HIGH_RISK_COMMAND.test(label)) return { risk: 'guarded', reason: 'desktop lifecycle command', highRisk: true }
  if (NAVIGATION_COMMAND.test(label.trim())) return { risk: 'safe' }
  // The shared button whitelist and explicit allow handle all other commands.
  return undefined
}
