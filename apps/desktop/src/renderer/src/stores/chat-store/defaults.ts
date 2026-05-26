/**
 * Public default-value entry for the chat-store package.
 *
 * Current state: factories and cache invalidators still live inline in
 * `./index.ts` (alongside the useChatStore body, since they read
 * module-level cache state populated by _loadDefaultSessionPrefs).
 * This file re-exports them so downstream code can adopt
 * `chat-store/defaults` as the import path now, making the future
 * migration (where the function bodies actually move here) a no-op for
 * consumers.
 *
 * Do NOT move the function definitions here yet — they share private
 * module state (_cachedDefaultPermissionMode, _cachedDefaultClaudeSelection,
 * etc.) with index.ts. Splitting them requires extracting the cache itself
 * first, which belongs to a focused later commit.
 */
export {
  createSessionId,
  createDefaultPerSessionState,
  createDefaultProjectState,
  getDefaultEffortForModel,
  invalidateDefaultPermissionModeCache,
  invalidateDefaultClaudePreferencesCache,
  invalidateDefaultCodexPreferencesCache,
} from './index'
