import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { scriptedShellArgs } from './shell-script-launch'

const script = "name='你好'\nprintf '%s\\n' \"$name\"\nexit 7\n"

function runScript(shell: string, body: string, home?: string): Promise<string> {
  const env = home ? { ...process.env, HOME: home, ZDOTDIR: home, BASH_ENV: '', ENV: '' } : process.env
  return new Promise((resolve, reject) => {
    const child = spawn(shell, scriptedShellArgs(shell, body), { stdio: ['ignore', 'pipe', 'pipe'], env })
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
    expect(args[1]).toContain('"$1" -ilc "$2"')
    expect(args[1]).toContain('exec "$1" -il')
    expect(args[3]).toBe('/opt/homebrew/bin/zsh')
    expect(args[4]).toBe(script)
    expect(args[1]).not.toContain(script)
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
    const home = mkdtempSync(join(tmpdir(), 'fence-zsh-'))
    try {
      const out = await runScript('/bin/zsh', script, home)
      expect(out).toContain('你好')
      expect(out).toContain('[exit 7]')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it.runIf(existsSync('/bin/zsh'))('runs zsh as a login interactive shell and keeps the command literal', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fence-rc-'))
    writeFileSync(join(home, '.zprofile'), "export FENCE_ZPROFILE=from-zprofile\n")
    writeFileSync(join(home, '.zshrc'), "export FENCE_ZSHRC=from-zshrc\n")
    const body = "printf '%s\\n' \"profile=$FENCE_ZPROFILE rc=$FENCE_ZSHRC\"\nprintf 'err-marker\\n' >&2\ncat <<'TEXT'\nliteral $HOME `date`\nTEXT\nexit 9\n"
    try {
      const out = await runScript('/bin/zsh', body, home)
      expect(out).toContain('profile=from-zprofile rc=from-zshrc')
      expect(out).toContain('err-marker')
      expect(out).toContain('literal $HOME `date`')
      expect(out).toContain('[exit 9]')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it.runIf(existsSync('/bin/sh'))('runs the script in sh and leaves the exit code visible', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fence-sh-'))
    try {
      const out = await runScript('/bin/sh', script, home)
      expect(out).toContain('你好')
      expect(out).toContain('[exit 7]')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
