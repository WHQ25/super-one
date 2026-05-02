import { describe, it, expect } from 'vitest'
import { parseManifest, parseDevLink } from './miniapp-schema'

describe('parseManifest', () => {
  const validManifest = {
    appId: 'hello',
    name: 'Hello',
    version: '1.0.0',
    type: 'sidebar',
    toolSlug: 'hello',
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

  const validInChatManifest = {
    appId: 'daily-report',
    name: 'Daily Report',
    type: 'in-chat' as const,
    description: 'Render daily reports',
    inChatToolName: 'render_daily_report',
    inChatToolDescription: 'Render a daily work report for the user',
    runningText: 'Generating report…',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
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

  it('should accept a valid in-chat manifest', () => {
    const result = parseManifest(validInChatManifest)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.type).toBe('in-chat')
      expect(result.manifest.inChatToolName).toBe('render_daily_report')
      expect(result.manifest.inChatToolDescription).toBe('Render a daily work report for the user')
      expect(result.manifest.runningText).toBe('Generating report…')
    }
  })

  it('should reject in-chat manifest without inChatToolName', () => {
    const { inChatToolName, ...rest } = validInChatManifest
    const result = parseManifest(rest)
    expect(result.ok).toBe(false)
  })

  it('should reject in-chat manifest without inputSchema', () => {
    const { inputSchema, ...rest } = validInChatManifest
    const result = parseManifest(rest)
    expect(result.ok).toBe(false)
  })

  it('should reject in-chat manifest with tools[]', () => {
    const result = parseManifest({
      ...validInChatManifest,
      tools: [{ name: 'bad', description: 'nope', inputSchema: { type: 'object' } }],
    })
    expect(result.ok).toBe(false)
  })

  it('should accept in-chat manifest without inChatToolDescription', () => {
    const { inChatToolDescription, ...rest } = validInChatManifest
    const result = parseManifest(rest)
    expect(result.ok).toBe(true)
  })

  it('should require toolSlug when tools are declared', () => {
    const { toolSlug, ...rest } = validManifest
    const result = parseManifest(rest)
    expect(result.ok).toBe(false)
  })

  it('should accept manifest with toolSlug and tools', () => {
    const result = parseManifest(validManifest)
    expect(result.ok).toBe(true)
  })

  it('should not require toolSlug when no tools declared', () => {
    const result = parseManifest({ appId: 'notool', name: 'No Tool' })
    expect(result.ok).toBe(true)
  })

  it('should accept runningText on tool definitions', () => {
    const result = parseManifest({
      ...validManifest,
      tools: [{
        name: 'do_thing',
        description: 'Does a thing',
        runningText: 'Doing the thing…',
        inputSchema: { type: 'object' },
      }],
    })
    expect(result.ok).toBe(true)
  })
})

describe('parseDevLink', () => {
  it('accepts a minimal dev link with only distDir', () => {
    const result = parseDevLink({ distDir: 'packages/dashboard/dist' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.devLink.distDir).toBe('packages/dashboard/dist')
      expect(result.devLink.enabled).toBe(true)
    }
  })

  it('defaults enabled to true when omitted', () => {
    const result = parseDevLink({ distDir: '/abs/path' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.devLink.enabled).toBe(true)
  })

  it('accepts enabled=false', () => {
    const result = parseDevLink({ distDir: '/abs/path', enabled: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.devLink.enabled).toBe(false)
  })

  it('accepts enabled=true explicitly', () => {
    const result = parseDevLink({ distDir: '/abs/path', enabled: true })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.devLink.enabled).toBe(true)
  })

  it('rejects when distDir missing', () => {
    const result = parseDevLink({ enabled: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('distDir'))).toBe(true)
    }
  })

  it('rejects empty distDir', () => {
    const result = parseDevLink({ distDir: '' })
    expect(result.ok).toBe(false)
  })

  it('rejects non-boolean enabled', () => {
    const result = parseDevLink({ distDir: 'x', enabled: 'yes' })
    expect(result.ok).toBe(false)
  })

  it('rejects non-string distDir', () => {
    const result = parseDevLink({ distDir: 123 })
    expect(result.ok).toBe(false)
  })

  it('rejects non-object input', () => {
    const result = parseDevLink('not an object')
    expect(result.ok).toBe(false)
  })

  it('rejects null', () => {
    const result = parseDevLink(null)
    expect(result.ok).toBe(false)
  })
})
