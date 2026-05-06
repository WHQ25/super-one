import { renameSync } from 'fs'
import { join } from 'path'
import log from 'electron-log/main.js'
import { is } from '@electron-toolkit/utils'

if (is.dev) {
  log.transports.file.resolvePathFn = () => join(process.cwd(), 'dev.log')
}

log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.archiveLogFn = (oldLog) => {
  renameSync(String(oldLog), `${oldLog}.old`)
}
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'

export default log
