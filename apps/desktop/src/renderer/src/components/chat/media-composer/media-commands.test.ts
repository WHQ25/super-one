import { expect, it } from 'vitest'
import { mediaSlashCommand } from './media-commands'
it('matches only host media commands and preserves multiline prompts', () => {
  expect(mediaSlashCommand('/image')).toEqual({ kind: 'image', prompt: '' })
  expect(mediaSlashCommand('/video  A forest\nAt dawn')).toEqual({ kind: 'video', prompt: 'A forest\nAt dawn' })
  expect(mediaSlashCommand('/image-other')).toBeNull()
  expect(mediaSlashCommand('Please /image')).toBeNull()
})
