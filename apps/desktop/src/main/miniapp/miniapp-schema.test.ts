import { describe, it, expect } from 'vitest'
import { parseManifest, parseDevLink } from './miniapp-schema'

describe('parseManifest', () => {
  const validManifest = {
    appId: 'hello',
    name: 'Hello',
    version: '1.0.0',
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

  it('should accept a valid manifest', () => {
    const result = parseManifest(validManifest)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.appId).toBe('hello')
      expect(result.manifest.version).toBe('1.0.0')
    }
  })

  it('accepts background entry when permissions.background is declared', () => {
    const result = parseManifest({
      appId: 'bg',
      name: 'Bg',
      background: { entry: 'background.html' },
      permissions: { background: { reason: 'finish downloads with panel closed' } },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects background entry without permissions.background', () => {
    const result = parseManifest({
      appId: 'bg',
      name: 'Bg',
      background: { entry: 'background.html' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join()).toMatch(/background requires permissions\.background/)
  })

  it('rejects a non-html background entry', () => {
    const result = parseManifest({
      appId: 'bg',
      name: 'Bg',
      background: { entry: 'worker.js' },
      permissions: { background: { reason: 'x' } },
    })
    expect(result.ok).toBe(false)
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

  it('should accept fullscreen flag', () => {
    const result = parseManifest({ ...validManifest, fullscreen: true })
    expect(result.ok).toBe(true)
  })

  it('should reject non-boolean fullscreen', () => {
    const result = parseManifest({ ...validManifest, fullscreen: 'yes' })
    expect(result.ok).toBe(false)
  })

  it('should accept preferWidth in valid range', () => {
    const result = parseManifest({ ...validManifest, preferWidth: 480 })
    expect(result.ok).toBe(true)
  })

  it('should reject preferWidth below MIN_AP (360)', () => {
    const result = parseManifest({ ...validManifest, preferWidth: 200 })
    expect(result.ok).toBe(false)
  })

  it('should reject preferWidth above max (2000)', () => {
    const result = parseManifest({ ...validManifest, preferWidth: 5000 })
    expect(result.ok).toBe(false)
  })

  it('should reject non-integer preferWidth', () => {
    const result = parseManifest({ ...validManifest, preferWidth: 480.5 })
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

  it('should accept permissions.media with microphone', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { media: [{ kind: 'microphone', reason: 'Voice input' }] },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.permissions?.media?.[0].kind).toBe('microphone')
    }
  })

  it('should accept permissions.media with camera', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { media: [{ kind: 'camera', reason: 'Capture frames' }] },
    })
    expect(result.ok).toBe(true)
  })

  it('should accept permissions.media with both kinds', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: {
        media: [
          { kind: 'microphone', reason: 'Voice' },
          { kind: 'camera', reason: 'Video' },
        ],
      },
    })
    expect(result.ok).toBe(true)
  })

  it('should reject permissions.media without reason', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { media: [{ kind: 'microphone' }] },
    })
    expect(result.ok).toBe(false)
  })

  it('should reject permissions.media with unknown kind', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { media: [{ kind: 'screen', reason: 'not supported' }] },
    })
    expect(result.ok).toBe(false)
  })

  it('should accept permissions.storage with reason', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { storage: { reason: 'Persist user preferences' } },
    })
    expect(result.ok).toBe(true)
  })

  it('should reject permissions.storage without reason', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { storage: {} },
    })
    expect(result.ok).toBe(false)
  })

  it('should reject permissions.storage with empty reason', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { storage: { reason: '' } },
    })
    expect(result.ok).toBe(false)
  })

  it('should reject permissions.storage as array', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { storage: [{ reason: 'x' }] },
    })
    expect(result.ok).toBe(false)
  })

  it('should reject permissions.storage as boolean', () => {
    const result = parseManifest({
      ...validManifest,
      permissions: { storage: true },
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

describe('parseManifest - standalone tools', () => {
  const baseStandalone = {
    appId: 'weather',
    name: 'Weather',
    toolSlug: 'weather',
    templates: { 'query-result': 'query-result.html' },
    tools: [
      {
        name: 'query',
        description: 'Query the weather API.',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        standalone: true,
        renderer: { result: { template: 'query-result' } },
      },
    ],
  }

  it('accepts manifest with standalone tool', () => {
    const result = parseManifest(baseStandalone)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.tools?.[0].standalone).toBe(true)
    }
  })

  it('accepts mixed tools (one standalone, one panel-bound)', () => {
    const result = parseManifest({
      appId: 'mixed',
      name: 'Mixed',
      toolSlug: 'mixed',
      templates: { 'query-result': 'query-result.html' },
      tools: [
        { name: 'query', description: 'bg', inputSchema: { type: 'object' }, standalone: true, renderer: { result: { template: 'query-result' } } },
        { name: 'show', description: 'ui', inputSchema: { type: 'object' }, standalone: false },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it('rejects standalone tool without renderer.result.template', () => {
    const result = parseManifest({
      appId: 'missing-tpl',
      name: 'Missing',
      toolSlug: 'missing',
      tools: [{
        name: 'query',
        description: 'no template',
        inputSchema: { type: 'object' },
        standalone: true,
      }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => /standalone/i.test(e) && /template/i.test(e))).toBe(true)
    }
  })

  it('defaults standalone undefined (backwards compatible)', () => {
    const result = parseManifest({
      appId: 'legacy',
      name: 'Legacy',
      toolSlug: 'legacy',
      tools: [{ name: 'foo', description: 'bar', inputSchema: { type: 'object' } }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.tools?.[0].standalone).toBeUndefined()
    }
  })

  it('accepts per-tool timeoutMs', () => {
    const result = parseManifest({
      ...baseStandalone,
      tools: [{ ...baseStandalone.tools[0], timeoutMs: 30000 }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.tools?.[0].timeoutMs).toBe(30000)
    }
  })

  it('rejects negative timeoutMs', () => {
    const result = parseManifest({
      ...baseStandalone,
      tools: [{ ...baseStandalone.tools[0], timeoutMs: -1 }],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects zero timeoutMs', () => {
    const result = parseManifest({
      ...baseStandalone,
      tools: [{ ...baseStandalone.tools[0], timeoutMs: 0 }],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects non-integer timeoutMs', () => {
    const result = parseManifest({
      ...baseStandalone,
      tools: [{ ...baseStandalone.tools[0], timeoutMs: 1000.5 }],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects non-boolean standalone', () => {
    const result = parseManifest({
      ...baseStandalone,
      tools: [{ ...baseStandalone.tools[0], standalone: 'yes' }],
    })
    expect(result.ok).toBe(false)
  })

  it('accepts standalone tool with both renderer.intercept and renderer.result', () => {
    const result = parseManifest({
      appId: 'hitl',
      name: 'HITL',
      toolSlug: 'hitl',
      templates: { 'confirm': 'confirm.html', 'card': 'card.html' },
      tools: [{
        name: 'confirm_increment',
        description: 'standalone tool that asks the user to confirm before running',
        inputSchema: { type: 'object' },
        standalone: true,
        renderer: {
          intercept: { template: 'confirm' },
          result: { template: 'card' },
        },
      }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const tool = result.manifest.tools?.[0]
      expect(tool?.renderer?.intercept?.template).toBe('confirm')
      expect(tool?.renderer?.result?.template).toBe('card')
    }
  })

  it('rejects standalone tool that declares renderer.intercept but no renderer.result', () => {
    const result = parseManifest({
      appId: 'bad',
      name: 'Bad',
      toolSlug: 'bad',
      templates: { 'pop': 'pop.html' },
      tools: [{
        name: 'incomplete',
        description: 'standalone still requires result.template even when intercept is set',
        inputSchema: { type: 'object' },
        standalone: true,
        renderer: { intercept: { template: 'pop' } },
      }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => /standalone/i.test(e) && /template/i.test(e))).toBe(true)
    }
  })

  it('accepts standalone tool with renderer.result (custom UI in chat)', () => {
    const result = parseManifest({
      appId: 'ui',
      name: 'UI',
      toolSlug: 'ui',
      templates: { 'counter': 'counter.html' },
      tools: [{
        name: 'increment',
        description: 'increment',
        inputSchema: { type: 'object' },
        standalone: true,
        renderer: { result: { template: 'counter' } },
      }],
    })
    expect(result.ok).toBe(true)
  })
})

describe('parseDevLink', () => {
  it('accepts an empty object and defaults enabled=true', () => {
    const result = parseDevLink({})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.devLink.enabled).toBe(true)
  })

  it('accepts enabled=false', () => {
    const result = parseDevLink({ enabled: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.devLink.enabled).toBe(false)
  })

  it('accepts enabled=true explicitly', () => {
    const result = parseDevLink({ enabled: true })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.devLink.enabled).toBe(true)
  })

  it('rejects legacy distDir field (strict mode)', () => {
    const result = parseDevLink({ distDir: 'packages/dashboard/dist', enabled: true })
    expect(result.ok).toBe(false)
  })

  it('rejects unknown fields (strict mode)', () => {
    const result = parseDevLink({ enabled: true, somethingElse: 1 })
    expect(result.ok).toBe(false)
  })

  it('rejects non-boolean enabled', () => {
    const result = parseDevLink({ enabled: 'yes' })
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
