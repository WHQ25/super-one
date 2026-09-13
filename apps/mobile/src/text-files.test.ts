import { describe, expect, it, vi } from 'vitest'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { loadTextFile, type TextFileHost } from './text-files'

const META = { name: 'notes.md', mimeType: 'text/markdown', size: 120, modifiedAt: 1 }

function host(answer: (command: RemoteCommand) => unknown): TextFileHost & { request: ReturnType<typeof vi.fn> } {
  return { request: vi.fn(async (command: RemoteCommand) => answer(command)) }
}

const base = { projectPath: '/proj', sessionId: 's1', path: 'docs/notes.md' }

describe('loadTextFile', () => {
  it('asks for the file inline by resolved path and hands back the text', async () => {
    const h = host(() => ({ ok: true, ...META, inline: true, text: '# Notes\n' }))
    await expect(loadTextFile({ ...base, host: h })).resolves.toEqual({ text: '# Notes\n' })
    expect(h.request.mock.calls[0][0]).toMatchObject({
      type: 'read_desktop_file', path: '/proj/docs/notes.md', projectPath: '/proj', sessionId: 's1', preferInline: true, statOnly: true,
    })
  })

  it('reports tooLarge when the host answers with metadata only, or refuses the size outright', async () => {
    await expect(loadTextFile({ ...base, host: host(() => ({ ok: true, ...META, size: 900_000, statOnly: true })) }))
      .resolves.toEqual({ tooLarge: true, size: 900_000 })
    await expect(loadTextFile({ ...base, host: host(() => ({ ok: false, error: 'too_large' })) }))
      .resolves.toEqual({ tooLarge: true })
  })

  it('throws on any other host error, and on a host too old to know the command', async () => {
    await expect(loadTextFile({ ...base, host: host(() => ({ ok: false, error: 'not_found', message: 'gone' })) })).rejects.toThrow('gone')
    await expect(loadTextFile({ ...base, host: host(() => ({ error: 'unknown command' })) })).rejects.toThrow('host cannot read text files')
  })
})
