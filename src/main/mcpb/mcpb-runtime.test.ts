import { describe, it, expect } from 'vitest'
import { resolveMcpbServer } from './mcpb-runtime'
import type { McpbManifest } from '../../shared/mcpb-types'

function nodeManifest(overrides: Partial<McpbManifest> = {}): McpbManifest {
  return {
    manifest_version: '0.3',
    name: 'test-bundle',
    version: '1.0.0',
    description: 'test',
    author: { name: 'Tester' },
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.js'],
        env: {},
      },
    },
    user_config: {},
    tools: [],
    tools_generated: false,
    prompts: [],
    prompts_generated: false,
    ...overrides,
  }
}

describe('resolveMcpbServer', () => {
  it('substitutes ${__dirname} into args', () => {
    const resolved = resolveMcpbServer({
      manifest: nodeManifest(),
      installDir: '/install',
      userConfig: {},
      electronExecPath: '/usr/bin/electron-fake',
    })
    expect(resolved.args).toEqual(['/install/server/index.js'])
  })

  it('injects ELECTRON_RUN_AS_NODE=1 and uses electronExecPath as command for node type', () => {
    const resolved = resolveMcpbServer({
      manifest: nodeManifest(),
      installDir: '/install',
      userConfig: {},
      electronExecPath: '/path/to/electron',
    })
    expect(resolved.command).toBe('/path/to/electron')
    expect(resolved.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('substitutes ${user_config.KEY} into env strings', () => {
    const m = nodeManifest({
      server: {
        type: 'node',
        entry_point: 'server/index.js',
        mcp_config: {
          command: 'node',
          args: ['${__dirname}/server/index.js'],
          env: { API_KEY: '${user_config.SECRET}' },
        },
      },
      user_config: {
        SECRET: { type: 'string', title: 'Secret', required: true, sensitive: true, multiple: false },
      },
    })
    const resolved = resolveMcpbServer({
      manifest: m,
      installDir: '/install',
      userConfig: { SECRET: 'super-secret' },
      electronExecPath: '/electron',
    })
    expect(resolved.env.API_KEY).toBe('super-secret')
  })

  it('expands a multi-value user_config arg into multiple args', () => {
    const m = nodeManifest({
      server: {
        type: 'node',
        entry_point: 'server/index.js',
        mcp_config: {
          command: 'node',
          args: ['--include', '${user_config.PATHS}'],
          env: {},
        },
      },
      user_config: {
        PATHS: { type: 'directory', title: 'Paths', required: true, sensitive: false, multiple: true },
      },
    })
    const resolved = resolveMcpbServer({
      manifest: m,
      installDir: '/install',
      userConfig: { PATHS: ['/a', '/b', '/c'] },
      electronExecPath: '/electron',
    })
    expect(resolved.args).toEqual(['--include', '/a', '/b', '/c'])
  })

  it('uses platform_overrides when current platform matches', () => {
    const m = nodeManifest({
      server: {
        type: 'binary',
        entry_point: 'bin/server',
        mcp_config: {
          command: '${__dirname}/bin/server',
          args: ['--default'],
          env: {},
          platform_overrides: {
            win32: { command: '${__dirname}/bin/server.exe', args: ['--win'] },
          },
        },
      },
    })
    const winResolved = resolveMcpbServer({
      manifest: m,
      installDir: '/install',
      userConfig: {},
      platform: 'win32',
      electronExecPath: '/electron',
    })
    expect(winResolved.command).toBe('/install/bin/server.exe')
    expect(winResolved.args).toEqual(['--win'])

    const macResolved = resolveMcpbServer({
      manifest: m,
      installDir: '/install',
      userConfig: {},
      platform: 'darwin',
      electronExecPath: '/electron',
    })
    expect(macResolved.command).toBe('/install/bin/server')
    expect(macResolved.args).toEqual(['--default'])
  })

  it('does not override command for python type bundles', () => {
    const m = nodeManifest({
      server: {
        type: 'python',
        entry_point: 'main.py',
        mcp_config: {
          command: 'python3',
          args: ['${__dirname}/main.py'],
          env: {},
        },
      },
    })
    const resolved = resolveMcpbServer({
      manifest: m,
      installDir: '/install',
      userConfig: {},
      electronExecPath: '/electron',
    })
    expect(resolved.command).toBe('python3')
    expect(resolved.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('substitutes ${HOME} from injected home option', () => {
    const m = nodeManifest({
      server: {
        type: 'binary',
        entry_point: 'bin/x',
        mcp_config: { command: 'x', args: ['${HOME}/data'], env: {} },
      },
    })
    const resolved = resolveMcpbServer({
      manifest: m,
      installDir: '/install',
      userConfig: {},
      home: '/Users/alice',
      electronExecPath: '/electron',
    })
    expect(resolved.args).toEqual(['/Users/alice/data'])
  })

  it('prepends --directory <installDir> to args for uv type so `uv run` finds the bundled pyproject.toml', () => {
    const m = nodeManifest({
      server: {
        type: 'uv',
        entry_point: 'pkg/__init__.py',
        mcp_config: {
          command: 'uv',
          args: ['run', 'blender-mcp'],
          env: {},
        },
      },
    })
    const resolved = resolveMcpbServer({
      manifest: m,
      installDir: '/install/Blender@1.0.0',
      userConfig: {},
      electronExecPath: '/electron',
    })
    expect(resolved.command).toBe('uv')
    expect(resolved.args).toEqual(['--directory', '/install/Blender@1.0.0', 'run', 'blender-mcp'])
  })

  it('does not double-inject --directory when manifest already includes it for uv type', () => {
    const m = nodeManifest({
      server: {
        type: 'uv',
        entry_point: 'pkg/__init__.py',
        mcp_config: {
          command: 'uv',
          args: ['--directory', '${__dirname}', 'run', 'something'],
          env: {},
        },
      },
    })
    const resolved = resolveMcpbServer({
      manifest: m,
      installDir: '/install',
      userConfig: {},
      electronExecPath: '/electron',
    })
    expect(resolved.args).toEqual(['--directory', '/install', 'run', 'something'])
  })

  it('replaces unknown user_config placeholder with empty string', () => {
    const m = nodeManifest({
      server: {
        type: 'node',
        entry_point: 'server/index.js',
        mcp_config: {
          command: 'node',
          args: ['${user_config.MISSING}'],
          env: {},
        },
      },
    })
    const resolved = resolveMcpbServer({
      manifest: m,
      installDir: '/install',
      userConfig: {},
      electronExecPath: '/electron',
    })
    expect(resolved.args).toEqual([''])
  })
})
