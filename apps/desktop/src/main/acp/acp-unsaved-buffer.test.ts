import { describe, it, expect, beforeEach } from 'vitest'
import { clearUnsavedBuffers, getUnsavedBuffer, setUnsavedBuffer } from './acp-unsaved-buffer'
import { resolve } from 'node:path'

describe('acp-unsaved-buffer', () => {
  beforeEach(() => clearUnsavedBuffers())

  it('stores and retrieves by resolved path', () => {
    setUnsavedBuffer('/tmp/a.ts', 'hello')
    expect(getUnsavedBuffer('/tmp/a.ts')).toBe('hello')
    expect(getUnsavedBuffer(resolve('/tmp/a.ts'))).toBe('hello')
  })

  it('clears when content is null', () => {
    setUnsavedBuffer('/tmp/a.ts', 'x')
    setUnsavedBuffer('/tmp/a.ts', null)
    expect(getUnsavedBuffer('/tmp/a.ts')).toBeNull()
  })
})
