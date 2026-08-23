/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { resolveMiniAppToolIdentity } from './miniapp-tool-identity'

const apps = [
  {
    id: 'excalidraw',
    manifest: {
      name: 'Excalidraw',
      tools: [
        {
          name: 'clear_canvas',
          description: 'Clear',
          inputSchema: { type: 'object', properties: {} },
          displayName: 'Clear canvas',
          groupable: true,
        },
        {
          name: 'widget',
          description: 'Widget',
          inputSchema: { type: 'object', properties: {} },
          standalone: true,
        },
      ],
    },
  },
]

describe('resolveMiniAppToolIdentity', () => {
  it('resolves fixed miniapp_call from appId + tool args', () => {
    const resolved = resolveMiniAppToolIdentity(
      'miniapp_call',
      { appId: 'excalidraw', tool: 'clear_canvas', input: { force: true } },
      apps,
    )
    expect(resolved).toMatchObject({
      appId: 'excalidraw',
      toolName: 'clear_canvas',
      legacy: false,
      toolInput: { force: true },
    })
    expect(resolved?.toolDef?.displayName).toBe('Clear canvas')
  })

  it('resolves legacy transcript names appId__tool', () => {
    const resolved = resolveMiniAppToolIdentity(
      'excalidraw__clear_canvas',
      { force: true },
      apps,
    )
    expect(resolved).toMatchObject({
      appId: 'excalidraw',
      toolName: 'clear_canvas',
      legacy: true,
      toolInput: { force: true },
    })
  })

  it('does not treat miniapp_list as an app tool', () => {
    expect(resolveMiniAppToolIdentity('miniapp_list', {}, apps)).toBeNull()
  })
})
