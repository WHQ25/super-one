import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { MobileShareService, type MobileShareServiceDeps, type MobileShareTarget } from './mobile-share-service'
import type { AgentEvent } from '@superone/shared/agent-types'

let dir: string
let filePath: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mshare-'))
  filePath = join(dir, 'note.txt')
  await writeFile(filePath, 'hello mobile')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

function makeDeps(target: MobileShareTarget | null) {
  const sent: Array<{ event: AgentEvent; targets: string[] }> = []
  const rendered: AgentEvent[] = []
  const deps: MobileShareServiceDeps = {
    resolveTarget: () => target,
    resolveDeviceName: () => 'iPhone 17 Pro',
    uploadFileToRelay: vi.fn(),
    sendAgentEvent: async (event, targets) => { sent.push({ event, targets }) },
    emitToRenderer: (event) => { rendered.push(event) },
    now: () => 1_000,
  }
  return { deps, sent, rendered }
}

describe('MobileShareService', () => {
  it('rejects when no mobile device is connected', async () => {
    const { deps } = makeDeps(null)
    const res = await new MobileShareService(deps).shareFile({ sessionId: 's1', path: filePath })
    expect(res.ok).toBe(false)
  })

  it('rejects a path outside the project roots', async () => {
    const { deps } = makeDeps({ deviceId: 'dev-A', projectPath: dir, allowedRoots: [join(dir, 'sub')] })
    const res = await new MobileShareService(deps).shareFile({ sessionId: 's1', path: filePath })
    expect(res.ok).toBe(false)
  })

  it('inlines a small file and delivers a shared_file event to the owner', async () => {
    const { deps, sent, rendered } = makeDeps({ deviceId: 'dev-A', projectPath: dir, allowedRoots: [dir] })
    const res = await new MobileShareService(deps).shareFile({ sessionId: 's1', path: filePath, caption: 'fyi' })

    expect(res.ok).toBe(true)
    expect(res.transport).toBe('inline')
    expect(res.deviceName).toBe('iPhone 17 Pro')
    expect(res.sentAt).toBe(1_000)

    expect(sent).toHaveLength(1)
    expect(sent[0].targets).toEqual(['dev-A'])
    const evt = sent[0].event
    expect(evt.type).toBe('shared_file')
    if (evt.type === 'shared_file') {
      expect(evt.file.name).toBe('note.txt')
      expect(evt.file.caption).toBe('fyi')
      expect(Buffer.from(evt.file.inlineBase64!, 'base64').toString()).toBe('hello mobile')
      expect(evt.file.downloadUrl).toBeUndefined()
    }

    const progress = rendered.filter((e) => e.type === 'shared_file_progress')
    expect(progress.length).toBeGreaterThanOrEqual(1)
    const last = progress[progress.length - 1]
    if (last.type === 'shared_file_progress') {
      expect(last.loaded).toBe(last.total)
    }
  })
})
