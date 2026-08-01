/** Re-export host-agnostic spawn env helpers from `@superone/runtime`. */
export {
  sanitizeEnv,
  sanitizePathEnv,
  buildSafeEnv,
  SPAWN_PATH_MAX,
  SPAWN_NAME_MAX,
  MAX_ENV_BYTES,
  type SanitizePathResult,
} from '@superone/runtime/spawn-env'
