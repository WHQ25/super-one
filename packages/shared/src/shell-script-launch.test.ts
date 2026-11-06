import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { scriptedShellArgs } from './shell-script-launch'

const script = "name='你好'\nprintf '%s\\n' \"$name\"\nexit 7\n"

function runScript(shell: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, scriptedShellArgs(shell, body), { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(out)
    }
    timer = setTimeout(() => {
      child.kill()
      finish(new Error(`timed out\n${out}`))
    }, 8000)
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      if (out.includes('[exit ')) child.kill()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on('close', () => finish())
    child.on('error', (error) => finish(error))
  })
}

describe('scriptedShellArgs', () => {
  it('passes a POSIX script as an argument to the requested shell', () => {
    const args = scriptedShellArgs('/opt/homebrew/bin/zsh', script)
    expect(args[0]).toBe('-c')
    expect(args[3]).toBe('/opt/homebrew/bin/zsh')
    expect(args[4]).toBe(script)
    expect(args.join('\n')).not.toContain('bash -c')
  })

  it('uses fish status and argv for a fish shell', () => {
    const args = scriptedShellArgs('/opt/homebrew/bin/fish', 'echo hi')
    expect(args[0]).toBe('--no-config')
    expect(args[3]).toBe('/opt/homebrew/bin/fish')
    expect(args[4]).toBe('echo hi')
    expect(args[2]).toContain('$status')
  })

  it('keeps PowerShell from closing when the script exits', () => {
    const args = scriptedShellArgs('C:\\Program Files\\PowerShell\\pwsh.exe', "name='a'\nexit 7")
    expect(args).toContain('-NoExit')
    expect(args.at(-1)).toContain("name=''a''")
    expect(args.at(-1)).toContain('[exit $code]')
  })

  it('hands cmd its script as the /K command', () => {
    expect(scriptedShellArgs('C:\\Windows\\System32\\cmd.exe', script)).toEqual(['/D', '/K', script])
  })

  it.runIf(existsSync('/bin/zsh'))('runs the script in zsh and leaves the exit code visible', async () => {
    const out = await runScript('/bin/zsh', script)
    expect(out).toContain('你好')
    expect(out).toContain('[exit 7]')
  })

  it.runIf(existsSync('/bin/sh'))('runs the script in sh and leaves the exit code visible', async () => {
    const out = await runScript('/bin/sh', script)
    expect(out).toContain('你好')
    expect(out).toContain('[exit 7]')
  })
})
