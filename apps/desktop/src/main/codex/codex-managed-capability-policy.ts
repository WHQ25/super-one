import type { CodexConfigRequirements } from '@superone/shared/agent-types'

const browserAndComputerUseDeniedBySession = new Map<string, boolean>()

export const CODEX_MANAGED_BROWSER_COMPUTER_DENIED_MESSAGE =
  '[Error] Browser and Computer Use are disabled by Codex managed policy for this session.'

export function setCodexManagedCapabilityPolicy(
  sessionId: string,
  requirements: Pick<CodexConfigRequirements, 'allowBrowserAndComputerUse'> | null,
): void {
  browserAndComputerUseDeniedBySession.set(
    sessionId,
    requirements?.allowBrowserAndComputerUse === false,
  )
}

export function clearCodexManagedCapabilityPolicy(sessionId: string): void {
  browserAndComputerUseDeniedBySession.delete(sessionId)
}

export function isCodexBrowserAndComputerUseDenied(sessionId: string): boolean {
  return browserAndComputerUseDeniedBySession.get(sessionId) === true
}
