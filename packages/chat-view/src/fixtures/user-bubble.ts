import type { ChatMessage, ChatMessageContext, ImageAttachment } from '@superone/shared/agent-types'
import { wrapAgentMention } from '@superone/shared/agent-mention-tags'
import { wrapCapabilityMention } from '@superone/shared/capability-prompt-tags'
import { wrapGitMention } from '@superone/shared/git-mention-tags'
import { encodeMcpMentionValue, formatMcpResourceReminder, wrapMcpResourceMention } from '@superone/shared/mcp-app-mentions'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'

/**
 * User messages with every chip a bubble draws, for the desktop and phone
 * stories that show the one shared bubble on both hosts.
 */

const SVG_PHOTO = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNjAgMTAwIj48cmVjdCB3aWR0aD0iMTYwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzM0ZDM5OSIvPjxjaXJjbGUgY3g9IjExNiIgY3k9IjMyIiByPSIxNCIgZmlsbD0iI2ZkZTA0NyIvPjxwYXRoIGQ9Ik0wIDEwMCA1MCA0NWw0MCA0MCAyMC0yMCA1MCAzNXoiIGZpbGw9IiMxNTgwM2QiLz48L3N2Zz4='

export const USER_BUBBLE_PHOTO: ImageAttachment = { id: 'photo', name: 'login-screen.svg', mimeType: 'image/svg+xml', base64: SVG_PHOTO }
export const USER_BUBBLE_PDF: ImageAttachment = { id: 'spec', name: 'auth-spec.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=' }

const MCP_VALUE = encodeMcpMentionValue('figma', 'figma://file/login')

export const USER_BUBBLE_PASTE = Array.from({ length: 14 }, (_, i) => `[auth] ${i + 1} token refresh failed: 401 at session-store.ts:${120 + i}`).join('\n')

const MENTIONS_TEXT = [
  `ultrathink 对比 ${wrapPathRefMention('file', 'src/main/session/session.ts', 'session.ts')} 和 ${wrapPathRefMention('directory', 'src/main/auth/', 'auth')}，`,
  `参考 ${wrapGitMention('issue:github:65', '#65 Login loops after token refresh')} 和 ${wrapMcpResourceMention(MCP_VALUE, 'Login frame')}，`,
  `用 ${wrapCapabilityMention('debug', 'Debug')} 查，派 ${wrapAgentMention('codex-base', 'Codex')} 复核，`,
  '结果放进 <superone-miniapp><appname>Board</appname><appid>board</appid></superone-miniapp>。',
].join('')

const MCP_REMINDER = formatMcpResourceReminder([{ server: 'figma', uri: 'figma://file/login', text: 'Frame "Login" — 375 × 812\nEmail field, password field, Sign in button' }])

export const USER_BUBBLE_CONTEXTS: ChatMessageContext[] = [
  { appId: 'board', appName: 'Board', summary: '3 cards in Doing', content: 'Doing:\n- Fix token refresh\n- Login e2e\n- Release notes', color: '#7c3aed' },
]

export const USER_BUBBLE_SELECTIONS = [
  'src/main/session/session.ts:L120-L122\nconst token = await refresh()\nif (!token) throw new AuthError()\nreturn token',
  'Token refresh fails right after the app wakes from sleep.',
]

/** One message with every chip: mentions of each kind, keywords, a paste, attachments, quotes and contexts. */
export function userBubbleMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'user-bubble',
    role: 'user',
    status: 'complete',
    providerId: 'user',
    createdAt: '2026-10-08T03:00:00.000Z',
    content: [
      { type: 'image', name: USER_BUBBLE_PHOTO.name, id: USER_BUBBLE_PHOTO.id },
      { type: 'document', name: USER_BUBBLE_PDF.name, id: USER_BUBBLE_PDF.id },
      { type: 'text', text: MENTIONS_TEXT + MCP_REMINDER, isPaste: false },
      { type: 'text', text: USER_BUBBLE_PASTE, isPaste: true },
    ],
    attachments: [USER_BUBBLE_PHOTO, USER_BUBBLE_PDF],
    userSelections: USER_BUBBLE_SELECTIONS,
    contexts: USER_BUBBLE_CONTEXTS,
    ...overrides,
  }
}

/** A goal: the bubble shows the objective under a Goal label. */
export function userBubbleGoalMessage(): ChatMessage {
  return userBubbleMessage({ content: [{ type: 'text', text: '/goal ultrathink ship the login flow, ultracode the tests' }], attachments: [], userSelections: [], contexts: [] })
}

/** A message from before pastes were marked: its long run still shows as a paste chip. */
export function userBubbleLegacyPasteMessage(): ChatMessage {
  return userBubbleMessage({ content: [{ type: 'text', text: `看下这段日志\n${USER_BUBBLE_PASTE}` }], attachments: [], userSelections: [], contexts: [] })
}
