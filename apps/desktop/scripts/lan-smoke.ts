import { spawn } from 'node:child_process'

if (process.platform !== 'darwin') {
  console.error('[smoke] this script only exercises the macOS dns-sd backend')
  process.exit(1)
}

const proc = spawn('dns-sd', [
  '-R', 'superone-smoke-test', '_superone._tcp', 'local', '54321',
  'roomId=room-smoke-xxx', 'hostName=smoke-host',
], { stdio: ['ignore', 'pipe', 'pipe'] })

proc.stdout?.on('data', (d) => process.stdout.write(`[dns-sd] ${d}`))
proc.stderr?.on('data', (d) => process.stderr.write(`[dns-sd!] ${d}`))

console.log('[smoke] registered via native dns-sd; verify with: dns-sd -B _superone._tcp local')

const cleanup = () => {
  proc.kill('SIGTERM')
  console.log('[smoke] killed dns-sd, exiting')
  process.exit(0)
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

await new Promise((r) => setTimeout(r, 10_000))
cleanup()
