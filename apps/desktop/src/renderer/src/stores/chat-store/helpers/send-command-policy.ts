import type { ChatProvider } from '../types'
import { CLAUDE_INTERCEPTED_COMMANDS } from '../index'

/** Cursor owns fewer host commands than Claude; other slash names reach its harness. */
export function shouldInterceptHostSlash(provider: ChatProvider, name: string): boolean {
  if (!CLAUDE_INTERCEPTED_COMMANDS[name]) return false
  if (provider === 'cursor') return name === 'clear' || name === 'mcp'
  return true
}
