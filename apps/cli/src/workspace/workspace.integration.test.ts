import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { isCodexBinaryOverrideRunnable } from '../session/codex-turn-runner'
import { isClaudeRuntimeRunnable } from '../session/claude-turn-runner'
import { connectAuthedRpc } from '../test/ws-rpc'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop()
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function boot(): Promise<NodeRuntime> {
  const nodeHome = mkdtempSync(join(tmpdir(), 'ws-node-'))
  dirs.push(nodeHome)
  // Ephemeral port: the OS picks a free one and the handle's `url` carries it
  // back, so parallel test files cannot collide.
  const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true })
  runtimes.push(rt)
  return rt
}

describe('Phase 2 workspace integration', () => {
  it('opens project, list/read/write/search, git status, and rejects traversal/symlink escape', async () => {
    const rt = await boot()
    const projectDir = mkdtempSync(join(tmpdir(), 'ws-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'readme.md'), 'hello workspace')
    mkdirSync(join(projectDir, 'src'))
    writeFileSync(join(projectDir, 'src', 'main.ts'), 'export const x = 1')
    execFileSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: projectDir, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: projectDir, stdio: 'ignore' })
    execFileSync('git', ['add', '.'], { cwd: projectDir, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: projectDir, stdio: 'ignore' })

    const { rpc, close } = await connectAuthedRpc(rt)
    const opened = (await rpc('project.open', { path: projectDir, name: 'demo' })) as {
      projectId: string
      path: string
    }
    expect(opened.path.includes('ws-proj-')).toBe(true)

    const listed = (await rpc('workspace.listDir', {
      projectId: opened.projectId,
      relativePath: '.',
    })) as Array<{ name: string }>
    expect(listed.some((e) => e.name === 'readme.md')).toBe(true)

    const read = (await rpc('workspace.readFile', {
      projectId: opened.projectId,
      relativePath: 'readme.md',
    })) as { content: string; hash: string; encoding?: string }
    expect(read.encoding).toBe('base64')
    expect(Buffer.from(read.content, 'base64').toString('utf8')).toContain('hello workspace')
    expect(read.hash).toHaveLength(64)

    await rpc('workspace.writeFile', {
      projectId: opened.projectId,
      relativePath: 'src/main.ts',
      content: 'export const x = 2\n',
    })
    const search = (await rpc('workspace.search', {
      projectId: opened.projectId,
      query: 'export const x',
    })) as Array<{ path: string }>
    expect(search.some((h) => h.path.includes('main.ts'))).toBe(true)

    const status = (await rpc('git.status', { projectId: opened.projectId })) as {
      isRepo: boolean
      dirty: boolean
      porcelain: string
    }
    expect(status.isRepo).toBe(true)
    expect(status.dirty).toBe(true)
    expect(status.porcelain).toContain('main.ts')

    // rename → move → delete (file-tree ops; avoid case-only rename on APFS)
    await rpc('workspace.rename', {
      projectId: opened.projectId,
      relativePath: 'readme.md',
      newName: 'hello.md',
    })
    await rpc('workspace.move', {
      projectId: opened.projectId,
      fromPath: 'hello.md',
      destDirPath: 'src',
    })
    const listedSrc = (await rpc('workspace.listDir', {
      projectId: opened.projectId,
      relativePath: 'src',
    })) as Array<{ name: string }>
    expect(listedSrc.some((e) => e.name === 'hello.md')).toBe(true)
    await rpc('workspace.delete', {
      projectId: opened.projectId,
      relativePath: 'src/hello.md',
    })
    const listedSrcAfter = (await rpc('workspace.listDir', {
      projectId: opened.projectId,
      relativePath: 'src',
    })) as Array<{ name: string }>
    expect(listedSrcAfter.some((e) => e.name === 'hello.md')).toBe(false)

    await rpc('workspace.mkdir', {
      projectId: opened.projectId,
      relativePath: 'empty-dir/nested',
    })
    const listedEmpty = (await rpc('workspace.listDir', {
      projectId: opened.projectId,
      relativePath: 'empty-dir',
    })) as Array<{ name: string }>
    expect(listedEmpty.some((e) => e.name === 'nested')).toBe(true)

    const branches = (await rpc('git.branches', { projectId: opened.projectId })) as {
      branches: string[]
    }
    expect(branches.branches.length).toBeGreaterThan(0)

    await expect(
      rpc('workspace.readFile', { projectId: opened.projectId, relativePath: '../outside' }),
    ).rejects.toBeTruthy()
    await expect(
      rpc('workspace.readFile', { projectId: opened.projectId, relativePath: '/etc/passwd' }),
    ).rejects.toBeTruthy()

    const outside = mkdtempSync(join(tmpdir(), 'ws-out-'))
    dirs.push(outside)
    writeFileSync(join(outside, 'secret'), 'no')
    symlinkSync(outside, join(projectDir, 'escape'))
    await expect(
      rpc('workspace.readFile', { projectId: opened.projectId, relativePath: 'escape/secret' }),
    ).rejects.toBeTruthy()

    close()
  })

  it('lists host directories via fs.listDir for add-project browser', async () => {
    const rt = await boot()
    const hostDir = mkdtempSync(join(tmpdir(), 'host-browse-'))
    dirs.push(hostDir)
    mkdirSync(join(hostDir, 'alpha-proj'))
    mkdirSync(join(hostDir, 'beta-proj'))
    mkdirSync(join(hostDir, '.hidden'))
    writeFileSync(join(hostDir, 'file.txt'), 'skip')

    const { rpc, close } = await connectAuthedRpc(rt)
    const listed = (await rpc('fs.listDir', { path: hostDir })) as {
      path: string
      entries: Array<{ name: string; path: string; type: string }>
    }
    expect(listed.path).toBe(hostDir)
    expect(listed.entries.map((e) => e.name).sort()).toEqual(['alpha-proj', 'beta-proj'])
    expect(listed.entries.every((e) => e.type === 'directory')).toBe(true)
    expect(listed.entries.every((e) => e.path.startsWith(hostDir))).toBe(true)

    await expect(rpc('fs.listDir', { path: join(hostDir, 'nope') })).rejects.toMatchObject({
      message: expect.stringMatching(/not found|path/i),
    })

    // Relative paths resolve against the node process cwd (shell-style).
    const prevCwd = process.cwd()
    try {
      process.chdir(hostDir)
      const hostReal = realpathSync(hostDir)
      const relListed = (await rpc('fs.listDir', { path: './' })) as {
        path: string
        entries: Array<{ name: string }>
      }
      expect(relListed.path).toBe(hostReal)
      expect(relListed.entries.map((e) => e.name).sort()).toEqual(['alpha-proj', 'beta-proj'])
    } finally {
      process.chdir(prevCwd)
    }

    // `~` expands on the node (remote principal home), not the desktop.
    const { homedir } = await import('node:os')
    const homeListed = (await rpc('fs.listDir', { path: '~' })) as {
      path: string
      entries: Array<{ name: string; type: string }>
    }
    expect(homeListed.path).toBe(homedir())
    expect(Array.isArray(homeListed.entries)).toBe(true)
    close()
  })

  it('opens and creates projects via relative paths and createIfMissing', async () => {
    const rt = await boot()
    const hostDir = mkdtempSync(join(tmpdir(), 'host-rel-'))
    dirs.push(hostDir)
    mkdirSync(join(hostDir, 'existing'))

    const { rpc, close } = await connectAuthedRpc(rt)
    const prevCwd = process.cwd()
    try {
      process.chdir(hostDir)
      const hostReal = realpathSync(hostDir)

      const opened = (await rpc('project.open', { path: './existing' })) as {
        projectId: string
        path: string
        name: string
      }
      expect(opened.path).toBe(join(hostReal, 'existing'))
      expect(opened.name).toBe('existing')

      const created = (await rpc('project.open', {
        path: './brand-new',
        createIfMissing: true,
      })) as { path: string; name: string }
      expect(created.path).toBe(join(hostReal, 'brand-new'))
      expect(existsSync(join(hostDir, 'brand-new'))).toBe(true)
      expect(created.name).toBe('brand-new')

      await expect(rpc('project.open', { path: './missing-no-create' })).rejects.toMatchObject({
        message: expect.stringMatching(/not a directory|path/i),
      })
    } finally {
      process.chdir(prevCwd)
      close()
    }
  })

  it('allows session list/create without simulatedHarness (production session surface)', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'sess-prod-'))
    dirs.push(nodeHome)
    // Fake codex binary so fail-closed runtime-ready accepts create; turns still use
    // simulated fallback so CI hosts without a real codex install can settle.
    const fakeCodex = join(nodeHome, 'fake-codex')
    writeFileSync(fakeCodex, '#!/bin/sh\n')
    chmodSync(fakeCodex, 0o755)
    const prevCodexEnv = process.env.SUPERONE_CODEX_BINARY
    process.env.SUPERONE_CODEX_BINARY = fakeCodex
    // No simulatedHarness overlay — production catalog/RPC path; allow turn fallback for CI.
    const rt = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      // Ephemeral port: the OS picks a free one and the handle's `url` carries
      // it back, so parallel test files cannot collide.
      bindPort: 0,
      allowSimulatedTurnFallback: true,
    })
    runtimes.push(rt)
    const projectDir = mkdtempSync(join(tmpdir(), 'sess-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'a.txt'), 'x')

    const { rpc, close } = await connectAuthedRpc(rt)
    try {
    const desc = (await rpc('environment.descriptor', {})) as {
      capabilities: { sessions: boolean; harnessIds: string[] }
    }
    expect(desc.capabilities.sessions).toBe(true)
    // Catalog entries fail closed, while directly runnable binary/SDK overrides are advertised.
    const runtimeOverrides = [
      ...(isCodexBinaryOverrideRunnable() ? ['codex'] : []),
      ...(isClaudeRuntimeRunnable() ? ['claude'] : []),
    ]
    expect(desc.capabilities.harnessIds).toEqual(runtimeOverrides)

    const opened = (await rpc('project.open', { path: projectDir })) as { projectId: string }
    await expect(rpc('session.create', {
      projectId: opened.projectId,
      harnessId: 'opencode',
    })).rejects.toThrow()

    // Enable codex as ready (admin path; Stage 1 uses in-process manager).
    rt.harnesses.update('codex', {
      enabled: true,
      state: 'ready',
      runtimeVersion: 'test',
      command: fakeCodex,
    })
    const created = (await rpc('session.create', {
      projectId: opened.projectId,
      harnessId: 'codex',
    })) as {
      sessionId: string
    }
    expect(created.sessionId).toBeTruthy()
    const listed = (await rpc('session.list', {
      projectId: opened.projectId,
      limit: 100,
      offset: 0,
    })) as Array<{
      sessionId: string
    }>
    expect(listed.some((s) => s.sessionId === created.sessionId)).toBe(true)

    const renamed = (await rpc('session.rename', {
      sessionId: created.sessionId,
      title: 'Hello remote',
    })) as { title: string | null }
    expect(renamed.title).toBe('Hello remote')

    // Send requires a control lease.
    const lease = (await rpc('session.acquireControl', {
      sessionId: created.sessionId,
      ttlMs: 30_000,
    })) as { leaseId: string; generation: string }
    await rpc('session.send', {
      sessionId: created.sessionId,
      text: 'ping',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    // Poll until turn settles (send starts async).
    let status = 'streaming'
    for (let i = 0; i < 50; i++) {
      const got = (await rpc('session.get', { sessionId: created.sessionId })) as {
        status: string
        transcript: Array<{ role: string; text: string }>
      }
      status = got.status
      if (status !== 'streaming') {
        expect(got.transcript.some((b) => b.role === 'user' && b.text === 'ping')).toBe(true)
        break
      }
      await new Promise((r) => setTimeout(r, 40))
    }
    expect(status).not.toBe('streaming')

    const removed = (await rpc('session.remove', {
      sessionId: created.sessionId,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })) as { sessionId: string }
    expect(removed.sessionId).toBe(created.sessionId)
    const after = (await rpc('session.list', {
      projectId: opened.projectId,
      limit: 100,
      offset: 0,
    })) as Array<{
      sessionId: string
    }>
    expect(after.some((s) => s.sessionId === created.sessionId)).toBe(false)
    } finally {
      close()
      if (prevCodexEnv === undefined) delete process.env.SUPERONE_CODEX_BINARY
      else process.env.SUPERONE_CODEX_BINARY = prevCodexEnv
    }
  })

  it('removes a registered project via project.remove without deleting disk', async () => {
    const rt = await boot()
    const projectDir = mkdtempSync(join(tmpdir(), 'ws-remove-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'keep.txt'), 'still here')

    const { rpc, close } = await connectAuthedRpc(rt)
    const opened = (await rpc('project.open', { path: projectDir, name: 'to-remove' })) as {
      projectId: string
      path: string
    }
    const listedBefore = (await rpc('project.list', {})) as Array<{ projectId: string }>
    expect(listedBefore.some((p) => p.projectId === opened.projectId)).toBe(true)

    const removed = (await rpc('project.remove', { projectId: opened.projectId })) as {
      projectId: string
      path: string
    }
    expect(removed.projectId).toBe(opened.projectId)

    const listedAfter = (await rpc('project.list', {})) as Array<{ projectId: string }>
    expect(listedAfter.some((p) => p.projectId === opened.projectId)).toBe(false)
    // Disk is untouched — remove is registry-only.
    expect(existsSync(join(projectDir, 'keep.txt'))).toBe(true)

    await expect(rpc('project.remove', { projectId: opened.projectId })).rejects.toMatchObject({
      message: expect.stringMatching(/not found/i),
    })
    close()
  })

  it('marks registered projects missing after their directory is removed', async () => {
    const rt = await boot()
    const projectDir = mkdtempSync(join(tmpdir(), 'ws-missing-'))
    dirs.push(projectDir)

    const { rpc, close } = await connectAuthedRpc(rt)
    const opened = (await rpc('project.open', { path: projectDir })) as {
      projectId: string
    }

    rmSync(projectDir, { recursive: true, force: true })

    const listed = (await rpc('project.list', {})) as Array<{
      projectId: string
      missing?: boolean
    }>
    expect(listed.find((project) => project.projectId === opened.projectId)?.missing).toBe(true)
    close()
  })
})
