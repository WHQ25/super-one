import type { UsageLog } from '@superone/runtime/usage'
import log from '../logger'

/** Routes runtime usage readers' messages into the desktop log. */
export const usageLog: UsageLog = {
  info: (message, ...args) => log.info(message, ...args),
  warn: (message, ...args) => log.warn(message, ...args),
}
