import type { SDKCustomTool, SDKJsonValue } from '@cursor/sdk'
import type { AskUserQuestionRequest } from '@superone/shared/agent-types'
import {
  buildCursorAskUserQuestionRequest,
  CURSOR_ASK_USER_QUESTION_SCHEMA,
  formatCursorQuestionResult,
  type CursorQuestionAnswer,
} from './cursor-interactions'

/** Name the model sees for the host question bridge (`custom-user-tools` server). */
export const CURSOR_ASK_USER_QUESTION_TOOL = 'superone_ask_user_question'

export interface CursorCustomToolsContext {
  sessionId: string
  cwd: string
  /**
   * Host question bridge. When present the agent gets `superone_ask_user_question`,
   * whose `execute` parks until the user answers in SuperOne. The SDK's own
   * `askQuestion` is hard-rejected in local SDK runs, so this is the only
   * supported way for a Cursor local agent to ask the user anything.
   */
  askUser?: (request: AskUserQuestionRequest) => Promise<CursorQuestionAnswer>
}

/**
 * Host-owned custom tools exposed to Cursor local agents as the
 * `custom-user-tools` MCP server (SDK LocalAgentOptions.customTools).
 *
 * SuperOne's full tool surface still arrives via the SuperOne MCP (see
 * cursor-mcp.ts). These in-process tools cover host metadata and the
 * interactive bridges that need a callback the model can await.
 */
export function buildCursorCustomTools(ctx: CursorCustomToolsContext): Record<string, SDKCustomTool> {
  const tools: Record<string, SDKCustomTool> = {
    superone_session_info: {
      description:
        'Return SuperOne host session metadata (session id, project cwd). Prefer SuperOne MCP tools for project actions.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => ({
        sessionId: ctx.sessionId,
        cwd: ctx.cwd,
        host: 'superone',
      }) as Record<string, SDKJsonValue>,
    },
  }
  const askUser = ctx.askUser
  if (askUser) {
    tools[CURSOR_ASK_USER_QUESTION_TOOL] = {
      description:
        'Ask the user one to four multiple-choice questions and wait for the answer. '
        + 'Use it whenever you need a decision, clarification or preference from the user before continuing. '
        + 'The built-in askQuestion tool is not available in this host; use this tool instead.',
      inputSchema: CURSOR_ASK_USER_QUESTION_SCHEMA as unknown as Record<string, SDKJsonValue>,
      execute: async (args, context) => {
        const requestId = context.toolCallId
          || `cursor_ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const request = buildCursorAskUserQuestionRequest(requestId, args)
        if (!request) {
          return {
            content: [{
              type: 'text',
              text: 'Invalid input: provide at least one question with two or more options.',
            }],
            isError: true,
          }
        }
        const answer = await askUser(request)
        return formatCursorQuestionResult(answer) as Record<string, SDKJsonValue>
      },
    }
  }
  return tools
}
