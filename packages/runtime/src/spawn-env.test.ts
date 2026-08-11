import { describe, it, expect } from 'vitest'
import {
  sanitizePathEnv,
  sanitizeEnv,
  buildSafeEnv,
  mergeLoopbackNoProxy,
  LOOPBACK_NO_PROXY_HOSTS,
  SPAWN_PATH_MAX,
  SPAWN_NAME_MAX,
  MAX_ENV_BYTES,
} from './spawn-env'

describe('sanitizePathEnv', () => {
  it('dedupes and drops empty entries', () => {
    const r = sanitizePathEnv('/a:/b::/a:/c')
    expect(r.deduped).toBe(1)
    expect(r.dropped).toBe(0)
    expect(r.value).toBe('/a:/b:/c')
  })

  it('drops components longer than PATH_MAX to avoid ENAMETOOLONG', () => {
    const long = '/' + 'x'.repeat(SPAWN_PATH_MAX + 10)
    const r = sanitizePathEnv(`/usr/bin:${long}:/bin`)
    expect(r.dropped).toBe(1)
    expect(r.droppedByPathMax).toBe(1)
    expect(r.value).toBe('/usr/bin:/bin')
  })

  it('drops entries whose a single dir-name component exceeds NAME_MAX', () => {
    // Segment is under PATH_MAX but contains a 300-byte directory name -> execve
    // returns ENAMETOOLONG on macOS. This is the path the old 1024 threshold missed.
    const bigComp = '/' + 'a'.repeat(SPAWN_NAME_MAX + 45)
    const seg = `/usr/bin${bigComp}/bin`
    expect(seg.length).toBeLessThan(SPAWN_PATH_MAX)
    const r = sanitizePathEnv(`/usr/bin:${seg}:/bin`)
    expect(r.dropped).toBe(1)
    expect(r.droppedByNameMax).toBe(1)
    expect(r.value).toBe('/usr/bin:/bin')
  })
})

describe('sanitizeEnv', () => {
  it('drops undefined values (they would crash Node env serializer)', () => {
    const out = sanitizeEnv({ A: '1', B: undefined } as NodeJS.ProcessEnv)
    expect(out.A).toBe('1')
    expect(out.B).toBeUndefined()
  })

  it('sanitizes PATH from the base env', () => {
    const long = '/' + 'y'.repeat(SPAWN_PATH_MAX + 5)
    const out = sanitizeEnv({ PATH: `/bin:${long}:/usr/bin` })
    expect(out.PATH).toBe('/bin:/usr/bin')
  })

  it('trims non-essential vars when over MAX_ENV_BYTES (E2BIG guard)', () => {
    const huge = 'z'.repeat(MAX_ENV_BYTES + 100)
    const out = sanitizeEnv({ PATH: '/bin', BIG: huge, HOME: '/home/x' })
    expect(out.BIG).toBeUndefined()
    expect(out.HOME).toBe('/home/x') // exact essential var, kept
    expect(out.PATH).toBe('/bin')
  })

  it('keeps essential-prefixed vars even when oversized', () => {
    const huge = 'z'.repeat(MAX_ENV_BYTES + 100)
    const out = sanitizeEnv({ PATH: '/bin', NODE_OPTIONS: huge })
    expect(out.NODE_OPTIONS).toBe(huge)
  })

  it('always injects loopback hosts into NO_PROXY / no_proxy', () => {
    const out = sanitizeEnv({ PATH: '/bin' })
    for (const host of LOOPBACK_NO_PROXY_HOSTS) {
      expect(out.NO_PROXY?.split(',')).toContain(host)
      expect(out.no_proxy?.split(',')).toContain(host)
    }
    expect(out.NO_PROXY).toBe(out.no_proxy)
  })

  it('preserves existing NO_PROXY entries and does not duplicate loopback', () => {
    const out = sanitizeEnv({
      PATH: '/bin',
      NO_PROXY: 'example.com,localhost,.internal',
    })
    const parts = out.NO_PROXY!.split(',')
    expect(parts).toContain('example.com')
    expect(parts).toContain('.internal')
    expect(parts.filter((p) => p.toLowerCase() === 'localhost')).toHaveLength(1)
    expect(parts).toContain('127.0.0.1')
    expect(parts).toContain('::1')
    expect(out.no_proxy).toBe(out.NO_PROXY)
  })

  it('merges no_proxy when only the lowercase key is set', () => {
    const out = sanitizeEnv({
      PATH: '/bin',
      no_proxy: 'corp.local',
    })
    expect(out.NO_PROXY!.split(',')).toContain('corp.local')
    expect(out.NO_PROXY!.split(',')).toContain('127.0.0.1')
    expect(out.no_proxy).toBe(out.NO_PROXY)
  })

  it('union-merges NO_PROXY and no_proxy when both are set', () => {
    const out = sanitizeEnv({
      PATH: '/bin',
      NO_PROXY: 'a.example',
      no_proxy: 'b.example,localhost',
    })
    const parts = out.NO_PROXY!.split(',')
    expect(parts).toContain('a.example')
    expect(parts).toContain('b.example')
    expect(parts.filter((p) => p.toLowerCase() === 'localhost')).toHaveLength(1)
    expect(parts).toContain('127.0.0.1')
  })
})

describe('mergeLoopbackNoProxy', () => {
  it('mutates env in place and dedupes case-insensitively', () => {
    const env: Record<string, string> = { NO_PROXY: 'LocalHost,foo' }
    mergeLoopbackNoProxy(env)
    expect(env.NO_PROXY).toBe(env.no_proxy)
    const parts = env.NO_PROXY!.split(',')
    expect(parts[0]).toBe('LocalHost')
    expect(parts).toContain('foo')
    expect(parts).toContain('127.0.0.1')
    expect(parts).toContain('::1')
    expect(parts.filter((p) => p.toLowerCase() === 'localhost')).toHaveLength(1)
  })
})

describe('buildSafeEnv', () => {
  it('merges extra over process.env and sanitizes PATH', () => {
    const out = buildSafeEnv({ MY_VAR: 'hi' })
    expect(out.MY_VAR).toBe('hi')
    expect(typeof out.PATH).toBe('string')
  })

  it('includes loopback NO_PROXY for child process spawns', () => {
    const out = buildSafeEnv()
    expect(out.NO_PROXY?.split(',')).toContain('127.0.0.1')
    expect(out.NO_PROXY?.split(',')).toContain('localhost')
    expect(out.NO_PROXY?.split(',')).toContain('::1')
  })
})
