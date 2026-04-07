import { describe, it, expect } from 'vitest'
import { parseManifest } from './miniapp-schema'

describe('parseManifest', () => {
  const validManifest = {
    appId: 'hello',
    name: 'Hello',
    version: '1.0.0',
    type: 'sidebar',
    tools: [
      {
        name: 'show_message',
        description: 'Show a message',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ],
  }

  it('should accept a valid manifest', () => {
    const result = parseManifest(validManifest)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.appId).toBe('hello')
      expect(result.manifest.version).toBe('1.0.0')
    }
  })

  it('should accept manifest with author object', () => {
    const result = parseManifest({
      ...validManifest,
      author: { name: 'Test User', email: 'test@example.com', url: 'https://example.com' },
    })
    expect(result.ok).toBe(true)
  })

  it('should accept manifest without optional fields', () => {
    const result = parseManifest({ appId: 'minimal', name: 'Minimal' })
    expect(result.ok).toBe(true)
  })

  it('should reject manifest without appId', () => {
    const result = parseManifest({ name: 'No ID' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('appId'))).toBe(true)
    }
  })

  it('should reject manifest without name', () => {
    const result = parseManifest({ appId: 'no-name' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('name'))).toBe(true)
    }
  })

  it('should reject invalid appId format', () => {
    const result = parseManifest({ appId: 'Hello World!', name: 'Test' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('appId'))).toBe(true)
    }
  })

  it('should reject appId starting with hyphen', () => {
    const result = parseManifest({ appId: '-bad', name: 'Test' })
    expect(result.ok).toBe(false)
  })

  it('should accept appId with hyphens and underscores', () => {
    const result = parseManifest({ appId: 'my-cool_app', name: 'Cool' })
    expect(result.ok).toBe(true)
  })

  it('should reject invalid tool name', () => {
    const result = parseManifest({
      ...validManifest,
      tools: [
        {
          name: 'Invalid-Name',
          description: 'Bad',
          inputSchema: { type: 'object' },
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('Tool name'))).toBe(true)
    }
  })

  it('should accept fullscreen type', () => {
    const result = parseManifest({ ...validManifest, type: 'fullscreen' })
    expect(result.ok).toBe(true)
  })

  it('should reject invalid type', () => {
    const result = parseManifest({ ...validManifest, type: 'unknown' })
    expect(result.ok).toBe(false)
  })

  it('should reject invalid author email', () => {
    const result = parseManifest({
      ...validManifest,
      author: { name: 'Test', email: 'not-an-email' },
    })
    expect(result.ok).toBe(false)
  })

  it('should allow extra properties in tool inputSchema', () => {
    const result = parseManifest({
      ...validManifest,
      tools: [
        {
          name: 'fancy_tool',
          description: 'Has extra schema props',
          inputSchema: {
            type: 'object',
            properties: { x: { type: 'number' } },
            additionalProperties: false,
            customField: true,
          },
        },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it('should accept permissions.fs with project scope', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { fs: [{ scope: 'project', path: '.', access: 'readwrite', reason: 'Read project files' }] },
    })
    expect(result.ok).toBe(true)
  })

  it('should accept permissions.fs with read-only access', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { fs: [{ scope: 'project', path: 'src', access: 'read', reason: 'Analyze source code' }] },
    })
    expect(result.ok).toBe(true)
  })

  it('should accept permissions.fs with multiple entries', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: {
        fs: [
          { scope: 'project', path: 'src', access: 'read', reason: 'Read source' },
          { scope: 'user', path: '.config/hello', access: 'readwrite', reason: 'Store config' },
          { scope: 'app', reason: 'Persist app data' },
        ],
      },
    })
    expect(result.ok).toBe(true)
  })

  it('should reject permissions.fs project scope without path', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { fs: [{ scope: 'project', access: 'read', reason: 'test' }] },
    })
    expect(result.ok).toBe(false)
  })

  it('should reject permissions.fs user scope without path', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { fs: [{ scope: 'user', access: 'readwrite', reason: 'test' }] },
    })
    expect(result.ok).toBe(false)
  })

  it('should reject permissions.fs without access', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { fs: [{ scope: 'project', path: '.', reason: 'test' }] },
    })
    expect(result.ok).toBe(false)
  })

  it('should reject permissions.fs without reason', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { fs: [{ scope: 'project', path: '.', access: 'read' }] },
    })
    expect(result.ok).toBe(false)
  })

  it('should accept permissions.fs app scope without path or access', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { fs: [{ scope: 'app', reason: 'Store data' }] },
    })
    expect(result.ok).toBe(true)
  })

  it('should accept permissions.network with structured entries', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { network: [{ domain: 'api.github.com', reason: 'Fetch repo data' }] },
    })
    expect(result.ok).toBe(true)
  })

  it('should reject permissions.network without reason', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { network: [{ domain: 'api.github.com' }] },
    })
    expect(result.ok).toBe(false)
  })

  it('should reject permissions.network as plain strings', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { network: ['api.github.com'] },
    })
    expect(result.ok).toBe(false)
  })

  it('should reject old string-based permissions.fs format', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { fs: 'project' },
    })
    expect(result.ok).toBe(false)
  })
})
