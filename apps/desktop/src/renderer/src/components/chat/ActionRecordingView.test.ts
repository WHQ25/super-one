import { describe, expect, it } from 'vitest'
import { parseActionRecording } from './ActionRecordingView'

describe('parseActionRecording', () => {
  it('extracts path-only recording metadata from an act result', () => {
    expect(
      parseActionRecording(
        JSON.stringify({
          ok: true,
          recording: {
            savedPath: '/recordings/action.webm',
            mimeType: 'video/webm',
            durationMs: 420,
          },
        }),
      ),
    ).toEqual({
      savedPath: '/recordings/action.webm',
      mimeType: 'video/webm',
      durationMs: 420,
    })
  })

  it('ignores malformed or inline-video results', () => {
    expect(parseActionRecording('{bad json')).toBeNull()
    expect(
      parseActionRecording(
        JSON.stringify({ recording: { data: 'large-base64' } }),
      ),
    ).toBeNull()
  })
})
