import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFile = vi.fn()

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFile(...args),
  execFileSync: () => {
    throw new Error('no git in test')
  },
}))

import { installPlugin } from './plugins-manage'

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

function lastSpawn() {
  const call = execFile.mock.calls.at(-1)
  if (!call) throw new Error('claude was not spawned')
  const [command, args, options, callback] = call as [string, string[], { timeout: number; cwd?: string }, ExecCallback]
  return { command, args, options, callback }
}

describe('claude plugin install', () => {
  beforeEach(() => {
    execFile.mockReset()
  })

  it('installs into the user scope without a project-path flag', async () => {
    const pending = installPlugin('demo@mp', 'user', '')
    const { command, args, options, callback } = lastSpawn()
    expect(command).toBe('claude')
    expect(args).toEqual(['plugin', 'install', 'demo@mp', '--scope', 'user', '--yes'])
    expect(options.cwd).toBeUndefined()
    expect(options.timeout).toBe(120_000)
    callback(null, '', '')
    await pending
  })

  it('installs a project plugin in that project directory', async () => {
    const pending = installPlugin('demo@mp', 'project', '/work/app')
    const { args, options, callback } = lastSpawn()
    expect(args).toEqual(['plugin', 'install', 'demo@mp', '--scope', 'project', '--yes'])
    expect(options.cwd).toBe('/work/app')
    callback(null, '', '')
    await pending
  })

  it('rejects a project install when no project is open', async () => {
    await expect(installPlugin('demo@mp', 'project', '  ')).rejects.toThrow('No project is open')
    expect(execFile).not.toHaveBeenCalled()
  })

  it('reports the CLI stderr when install fails', async () => {
    const pending = installPlugin('demo@mp', 'user', '')
    const { callback } = lastSpawn()
    callback(
      new Error('Command failed: claude plugin install demo@mp --scope user --yes'),
      'Installing plugin "demo@mp"...',
      '✘ Failed to install plugin "demo@mp": missing\n',
    )
    await expect(pending).rejects.toThrow('Failed to install plugin "demo@mp": missing')
  })

  it('keeps the spawn error when the CLI only printed its progress line', async () => {
    const pending = installPlugin('demo@mp', 'user', '')
    const { callback } = lastSpawn()
    callback(new Error('Command failed: claude plugin install demo@mp --scope user --yes'), 'Installing plugin "demo@mp"...', '')
    await expect(pending).rejects.toThrow('Failed to install plugin: Command failed: claude plugin install demo@mp --scope user --yes')
  })
})
