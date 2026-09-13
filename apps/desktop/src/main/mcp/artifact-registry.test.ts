import { afterEach, describe, expect, it } from 'vitest'
import { collectArtifacts, registerArtifact, resetArtifactRegistry, takeArtifacts } from './artifact-registry'

afterEach(() => resetArtifactRegistry())

describe('artifact registry', () => {
  it('hands the executor exactly the refs a call registered, then forgets them', async () => {
    await collectArtifacts('s1', 'call-1', async () => {
      registerArtifact('s1', { path: '/zone/s1/browser/a.png', producer: 'browser', final: true })
      await Promise.resolve()
      registerArtifact('s1', { path: '/zone/s1/browser/a.agent.jpg', producer: 'browser', final: true })
    })
    expect(takeArtifacts('s1', 'call-1')).toEqual([
      { path: '/zone/s1/browser/a.png', producer: 'browser', final: true },
      { path: '/zone/s1/browser/a.agent.jpg', producer: 'browser', final: true },
    ])
    expect(takeArtifacts('s1', 'call-1')).toEqual([])
  })

  it('keeps two concurrent calls of one session apart', async () => {
    let releaseA!: () => void
    const gateA = new Promise<void>((resolve) => { releaseA = resolve })
    const a = collectArtifacts('s1', 'call-a', async () => {
      registerArtifact('s1', { path: '/zone/s1/browser/a.png', producer: 'browser', final: true })
      await gateA
    })
    await collectArtifacts('s1', 'call-b', async () => {
      registerArtifact('s1', { path: '/zone/s1/computer-use/b.png', producer: 'computer-use', final: true })
    })
    releaseA()
    await a
    expect(takeArtifacts('s1', 'call-a').map((r) => r.path)).toEqual(['/zone/s1/browser/a.png'])
    expect(takeArtifacts('s1', 'call-b').map((r) => r.path)).toEqual(['/zone/s1/computer-use/b.png'])
  })

  it('re-registering a path replaces its earlier entry (a recording sealed after start)', async () => {
    await collectArtifacts('s1', 'call-1', async () => {
      registerArtifact('s1', { path: '/zone/s1/recording/r.mp4', producer: 'recording', final: false })
      registerArtifact('s1', { path: '/zone/s1/recording/r.mp4', producer: 'recording', final: true })
    })
    expect(takeArtifacts('s1', 'call-1')).toEqual([{ path: '/zone/s1/recording/r.mp4', producer: 'recording', final: true }])
  })

  it('falls back to the latest open scope of the session when the async context is lost', async () => {
    // An IPC reply lands from the event loop, in the emitter's context, not the tool's.
    const { EventEmitter } = await import('node:events')
    const ipc = new EventEmitter()
    const call = collectArtifacts('s1', 'call-1', () => new Promise<void>((resolve) => {
      ipc.once('reply', () => {
        registerArtifact('s1', { path: '/zone/s1/browser/late.png', producer: 'browser', final: true })
        resolve()
      })
    }))
    ipc.emit('reply')
    await call
    expect(takeArtifacts('s1', 'call-1').map((r) => r.path)).toEqual(['/zone/s1/browser/late.png'])
  })

  it('ignores registrations outside any scope and refuses a take for the wrong session', async () => {
    registerArtifact('s1', { path: '/zone/s1/browser/orphan.png', producer: 'browser', final: true })
    await collectArtifacts('s1', 'call-1', async () => {
      registerArtifact('s1', { path: '/zone/s1/browser/a.png', producer: 'browser', final: true })
    })
    expect(takeArtifacts('s2', 'call-1')).toEqual([])
    expect(takeArtifacts('s1', 'call-1')).toHaveLength(1)
  })
})
