/**
 * Public type entry for the chat-store package.
 *
 * Current state: source of truth still lives inline in `./index.ts`
 * (alongside the useChatStore body). This file re-exports those types so
 * downstream code can adopt `chat-store/types` as the import path now,
 * making the future migration (where the type definitions actually move
 * here) a no-op for consumers.
 *
 * Do NOT add type definitions here yet — that's the next refactor step,
 * and adding them now would cause TS2484 conflicts with index.ts.
 */
export type {
  ChatProvider,
  ChatStore,
  MentionKind,
  Mention,
  MiniAppContextSlot,
  PerSessionState,
  ProjectState,
  ActiveSessionView,
  ToolRendererState,
} from './index'
