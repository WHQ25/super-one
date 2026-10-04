import { expect, it } from 'vitest'
import { withModDevFoldersEnv } from './dev-folders'

it('leaves the env alone without folders', () => {
  const env = { PATH: '/bin' }
  expect(withModDevFoldersEnv(env, [])).toBe(env)
})

it('adds the folders after inherited ones and turns watching on', () => {
  expect(withModDevFoldersEnv({ CLAUDE_CODE_PLUGIN_DIRS: '/a' }, ['/b', '/a'])).toEqual({
    CLAUDE_CODE_PLUGIN_DIRS: '/a:/b',
    CLAUDE_CODE_PLUGIN_DIR_WATCH: '1',
  })
})
