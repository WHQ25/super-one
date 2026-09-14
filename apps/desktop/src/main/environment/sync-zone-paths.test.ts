import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/Users/me/Library/Application Support/SuperOne' } }))

import { mapNodeZoneArgs, mentionsArtifactPath, nodeTwinOf, nodeZonePath, parseNodeZonePath, rewriteArtifactPaths } from './sync-zone-paths'

const linux = { syncRoot: '/home/node/.superone/node/sync', os: 'linux' as const }
const windows = { syncRoot: 'C:\\Users\\node\\.superone\\node\\sync', os: 'windows' as const }
const desktopZone = '/Users/me/Library/Application Support/SuperOne/sync'

describe('sync zone prefix mapping', () => {
  it('builds the node twin of a desktop zone path in the node separator', () => {
    expect(nodeTwinOf(linux, `${desktopZone}/s1/browser/shot.png`)).toBe('/home/node/.superone/node/sync/s1/browser/shot.png')
    expect(nodeTwinOf(windows, `${desktopZone}/s1/browser/shot.png`)).toBe('C:\\Users\\node\\.superone\\node\\sync\\s1\\browser\\shot.png')
    expect(nodeTwinOf(linux, '/Users/me/project/shot.png')).toBeNull()
  })

  it('parses a node zone path textually without resolving it locally', () => {
    expect(parseNodeZonePath(linux, '/home/node/.superone/node/sync/s1/agent/report.md')).toEqual({ sessionId: 's1', relativePath: 'agent/report.md' })
    expect(parseNodeZonePath(windows, 'C:\\Users\\node\\.superone\\node\\sync\\s1\\agent\\report.md')).toEqual({ sessionId: 's1', relativePath: 'agent/report.md' })
    expect(parseNodeZonePath(windows, 'c:\\users\\node\\.superone\\node\\sync\\s1\\a.md')).toEqual({ sessionId: 's1', relativePath: 'a.md' })
    expect(parseNodeZonePath(linux, '/home/node/.superone/node/sync/s1')).toBeNull()
    expect(parseNodeZonePath(linux, '/home/node/.superone/node/synced/s1/a.md')).toBeNull()
    expect(parseNodeZonePath(linux, '/home/node/.superone/node/sync/s1/../s2/a.md')).toBeNull()
    expect(parseNodeZonePath(linux, '/home/node/project/a.md')).toBeNull()
    expect(nodeZonePath({ ...linux, syncRoot: '/home/node/.superone/node/sync/' }, 's1', 'agent/x')).toBe('/home/node/.superone/node/sync/s1/agent/x')
  })

  it('rewrites whole path tokens only, in raw and JSON-escaped form', () => {
    const from = `${desktopZone}/s1/browser/shot.png`
    const to = nodeTwinOf(linux, from)!
    // `shot.png.bak` is another file — one that was never pushed — not a mention of shot.png.
    const text = JSON.stringify({ path: from, note: `see ${from}.`, other: `${from}.bak`, page: 'the string sync/s1 appears in page text' })
    const out = rewriteArtifactPaths(text, new Map([[from, to]]))
    expect(JSON.parse(out)).toEqual({ path: to, note: `see ${to}.`, other: `${from}.bak`, page: 'the string sync/s1 appears in page text' })
    expect(mentionsArtifactPath(text, from)).toBe(true)
    expect(mentionsArtifactPath(JSON.stringify({ other: `${from}.bak` }), from)).toBe(false)
    // A Windows desktop path is doubled in JSON text; that form is rewritten too.
    const win = 'C:\\Users\\me\\sync\\s1\\browser\\shot.png'
    const winText = JSON.stringify({ path: win })
    expect(JSON.parse(rewriteArtifactPaths(winText, new Map([[win, '/home/node/sync/s1/browser/shot.png']])))).toEqual({ path: '/home/node/sync/s1/browser/shot.png' })
  })

  it('keeps JSON content parseable when the node twin carries backslashes', () => {
    // A POSIX desktop path needs no escaping, so a text-level replace would
    // drop C:\node\... unescaped into the JSON string and break the reply.
    const from = `${desktopZone}/s1/browser/shot.png`
    const to = nodeTwinOf(windows, from)!
    const text = JSON.stringify({ path: from, nested: JSON.stringify({ inner: from }) })
    const out = rewriteArtifactPaths(text, new Map([[from, to]]))
    const parsed = JSON.parse(out) as { path: string; nested: string }
    expect(parsed.path).toBe(to)
    // A string value that is itself JSON is rewritten at its own level and stays JSON.
    expect(JSON.parse(parsed.nested)).toEqual({ inner: to })
    // Plain text gets the raw twin.
    expect(rewriteArtifactPaths(`saved to ${from}`, new Map([[from, to]]))).toBe(`saved to ${to}`)
  })

  it('prefers the longest registered path when one is a prefix of another', () => {
    const short = `${desktopZone}/s1/browser/shot.png`
    const long = `${desktopZone}/s1/browser/shot.png.agent.jpg`
    const mapping = new Map([[short, nodeTwinOf(linux, short)!], [long, nodeTwinOf(linux, long)!]])
    expect(rewriteArtifactPaths(`${short} and ${long}`, mapping)).toBe(`${nodeTwinOf(linux, short)} and ${nodeTwinOf(linux, long)}`)
  })

  it('maps node zone strings anywhere in structured args to the desktop mirror', () => {
    const { args, refs } = mapNodeZoneArgs(linux, {
      data: { images: [{ path: '/home/node/.superone/node/sync/s1/agent/a.png' }, { base64: 'AAA' }] },
      referenceImages: ['/home/node/.superone/node/sync/s1/agent/a.png', '/home/node/project/b.png'],
      title: 'x',
    })
    expect(args).toEqual({
      data: { images: [{ path: `${desktopZone}/s1/agent/a.png` }, { base64: 'AAA' }] },
      referenceImages: [`${desktopZone}/s1/agent/a.png`, '/home/node/project/b.png'],
      title: 'x',
    })
    expect(refs).toEqual([{ sessionId: 's1', relativePath: 'agent/a.png', desktopPath: `${desktopZone}/s1/agent/a.png` }])
  })
})
