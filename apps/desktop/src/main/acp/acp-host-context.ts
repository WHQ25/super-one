import { ACP_SYSTEM_PROMPT_BLOCK } from '../agent/superone-system-prompt'

/** Grok (and other ACP agents) parse slash commands from the first text block. */
export function isLeadingSlashPrompt(text: string): boolean {
  return text.trimStart().startsWith('/')
}

export function acpHostContextText(systemPromptAppend?: string): string {
  return [ACP_SYSTEM_PROMPT_BLOCK, systemPromptAppend].filter(Boolean).join('\n\n')
}
