import type { SDKCustomTool, SDKJsonValue } from '@cursor/sdk'
import type { AskUserQuestionRequest } from '@superone/shared/agent-types'
import {
  buildCursorAskUserQuestionRequest,
  CURSOR_ASK_USER_QUESTION_SCHEMA,
  CURSOR_ASK_USER_QUESTION_TOOL,
  formatCursorQuestionResult,
  type CursorQuestionAnswer,
} from './cursor-interactions'

export { CURSOR_ASK_USER_QUESTION_TOOL }

export interface CursorCustomToolsContext {
  /**
   * Host question bridge. `execute` parks until the user answers in SuperOne.
   * The SDK's own `askQuestion` is hard-rejected in local SDK runs, so this is
   * the only supported way for a Cursor local agent to ask the user anything.
   */
  askUser: (request: AskUserQuestionRequest) => Promise<CursorQuestionAnswer>
}

/**
 * Host-owned custom tools exposed to Cursor local agents as the
 * `custom-user-tools` MCP server (SDK LocalAgentOptions.customTools).
 *
 * SuperOne's full tool surface still arrives via the SuperOne MCP (see
 * cursor-mcp.ts). The question bridge stays in-process because its callback
 * must await the user's answer.
 */
export function buildCursorCustomTools(ctx: CursorCustomToolsContext): Record<string, SDKCustomTool> {
  const askUser = ctx.askUser
  return {
    [CURSOR_ASK_USER_QUESTION_TOOL]: {
      description:
        'Ask the user one to four multiple-choice questions and wait for the answer. '
        + 'Use it whenever you need a decision, clarification or preference from the user before continuing. '
        + 'The built-in askQuestion tool is not available in this host; use this tool instead.',
      inputSchema: CURSOR_ASK_USER_QUESTION_SCHEMA as unknown as Record<string, SDKJsonValue>,
      execute: async (args, context) => {
        const requestId = context.toolCallId
          || `cursor_ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const parsed = buildCursorAskUserQuestionRequest(requestId, args)
        if (!parsed.ok) {
          // Schema-level rejection: the model gets the exact violation and the
          // user is never shown a partially valid prompt.
          return {
            content: [{ type: 'text', text: `Invalid input: ${parsed.error}` }],
            isError: true,
          }
        }
        const answer = await askUser(parsed.request)
        return formatCursorQuestionResult(answer) as Record<string, SDKJsonValue>
      },
    },
  }
}
