import { renameSync } from 'fs'
import { devRunFile } from './dev-run-file'
import log from 'electron-log/main.js'
import { is } from '@electron-toolkit/utils'

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err
  })
}

if (is.dev) {
  log.transports.file.resolvePathFn = () => devRunFile('dev', '.log')
}

const archive = (oldLog: unknown) => {
  renameSync(String(oldLog), `${oldLog}.old`)
}

log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.archiveLogFn = archive
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'

/**
 * Paired phones' uploaded diagnostics (`remote/mobile-log.ts`), in `mobile.log`
 * beside `main.log`. Lines are written pre-formatted: each carries the phone's
 * own timestamp, not the time it reached the desktop.
 */
let mobileLogger: typeof log | null = null
export function mobileLog(): typeof log {
  if (mobileLogger) return mobileLogger
  const logger = log.create({ logId: 'mobile' })
  logger.transports.console.level = false
  logger.transports.file.fileName = 'mobile.log'
  if (is.dev) logger.transports.file.resolvePathFn = () => devRunFile('dev-mobile', '.log')
  logger.transports.file.maxSize = 2 * 1024 * 1024
  logger.transports.file.archiveLogFn = archive
  logger.transports.file.format = '{text}'
  return (mobileLogger = logger)
}

export default log
