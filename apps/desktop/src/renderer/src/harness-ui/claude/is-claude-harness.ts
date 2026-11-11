export function isClaudeHarness(harnessId: string | null | undefined): harnessId is 'claude' {
  return harnessId === 'claude'
}
