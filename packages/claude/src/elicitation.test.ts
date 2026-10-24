import { describe, expect, it } from 'vitest'
import { claudeElicitationRequest } from './elicitation'

describe('claudeElicitationRequest', () => {
  it('shows a URL request with its URL and answers it when the link opens', () => {
    expect(claudeElicitationRequest('e1', {
      serverName: 'github',
      message: 'Sign in to GitHub',
      mode: 'url',
      url: 'https://github.com/login/device',
      elicitationId: 'el-1',
      description: 'Ignored: the URL is what the user must see',
    })).toEqual({
      requestId: 'e1',
      toolName: 'github',
      toolUseId: 'e1',
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'mcp_elicitation',
      serverName: 'github',
      message: 'Sign in to GitHub',
      subtitle: 'https://github.com/login/device',
      elicitationUrl: 'https://github.com/login/device',
      elicitationAcceptOnOpen: true,
      elicitationId: 'el-1',
    })
  })

  it('has nothing to show for a URL request without a URL', () => {
    expect(claudeElicitationRequest('e1', { serverName: 'github', message: 'Sign in', mode: 'url' })).toBeUndefined()
  })

  it('takes the server\'s permission display copy over its message', () => {
    const request = claudeElicitationRequest('e1', {
      serverName: 'mcp-deploy',
      message: 'raw prompt text',
      title: 'Deploy to production?',
      displayName: 'Deploy',
      description: 'Pushes build 42 to prod',
    })
    expect(request).toMatchObject({ message: 'Deploy to production?', subtitle: 'Pushes build 42 to prod', serverLabel: 'Deploy', serverName: 'mcp-deploy' })
    expect(request).not.toHaveProperty('elicitationAcceptOnOpen')
  })

  it('keeps the message as the subtitle when only a title is given', () => {
    expect(claudeElicitationRequest('e1', { serverName: 's', message: 'Body', title: 'Header' }))
      .toMatchObject({ message: 'Header', subtitle: 'Body' })
  })

  it('parses a form request\'s schema', () => {
    const request = claudeElicitationRequest('e1', {
      serverName: 's',
      message: 'Pick one',
      mode: 'form',
      requestedSchema: { type: 'object', properties: { env: { type: 'string', enum: ['dev', 'prod'] } }, required: ['env'] },
    })
    expect(request?.schemaForm).toMatchObject({ supported: true })
    expect(request).not.toHaveProperty('elicitationUrl')
  })
})
