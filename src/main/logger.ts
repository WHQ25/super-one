import { renameSync } from 'fs'
import log from 'electron-log/main'

log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.archiveLogFn = (oldLog) => {
  renameSync(String(oldLog), `${oldLog}.old`)
}
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'

export default log
