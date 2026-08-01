/**
 * @superone/runtime — host execution foundations (harness-agnostic).
 *
 * Subpaths:
 * - session — turn loop, event log, sqlite session store
 * - fs — path security + inventory
 * - git — pure helpers + gitRun + status porcelain parse
 * - lease — control lease service
 * - spawn-env — safe child env
 * - crypto — shared crypto helpers
 */

export * from './session/index'
export * as fs from './fs/index'
export * as git from './git/index'
export { ControlLeaseService } from './lease/index'
export {
  sanitizeEnv,
  sanitizePathEnv,
  buildSafeEnv,
  SPAWN_PATH_MAX,
  SPAWN_NAME_MAX,
  MAX_ENV_BYTES,
  type SanitizePathResult,
} from './spawn-env'
export type { SqliteDatabase, SqlStatement, SqlRunResult } from './sqlite'
export * from './crypto/index'
