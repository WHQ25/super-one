import type { ChatMessage } from '@superone/shared/agent-types'
import { textMessage } from '@superone/shared/transcript-window/window-fixtures'

/** A short visible tail behind many collapsed process fragments. */
export function collapsedHistoryTranscript(): ChatMessage[] {
  return [textMessage('ask', 'user', 'Check the project.'), {
    ...textMessage('reply', 'assistant', ''),
    content: [
      { type: 'text', text: `Opening explanation.\n\n${'The earlier explanation fills the conversation viewport. '.repeat(100)}` },
      ...Array.from({ length: 100 }, (_, i) => [
        { type: 'tool_use' as const, toolName: 'Write', toolUseId: `write-${i}`, input: JSON.stringify({ file_path: `/src/file${i}.ts` }), status: 'complete' as const },
        { type: 'tool_result' as const, toolUseId: `write-${i}`, summary: 'File updated.' },
        { type: 'thinking' as const, thinking: 'Checking the next file.' },
      ]).flat(),
      { type: 'text', text: 'Completed all project checks.' },
    ],
  }]
}
