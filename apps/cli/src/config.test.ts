import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'

afterEach(() => vi.unstubAllEnvs())
it.each(['stable', 'alpha'] as const)('uses %s roots for node, memory, harness and services', async variant => {
  vi.stubEnv('SUPERONE_VARIANT', variant)
  vi.stubEnv('SUPERONE_HOME', '')
  vi.stubEnv('SUPERONE_NODE_HOME', '')
  vi.stubEnv('SUPERONE_HARNESS_HOME', '')
  vi.resetModules()
  const { resolveNodeHome, DEFAULT_BIND_PORT } = await import('./config')
  const { resolveSuperoneHome } = await import('@superone/runtime/fs/superone-home')
  const { resolveHarnessHomeRoot } = await import('@superone/runtime/harness/home-path')
  const { renderSystemdUserUnit, SYSTEMD_USER_UNIT_NAME } = await import('./systemd/unit')
  const root = join(homedir(), '.superone', variant === 'alpha' ? 'alpha' : '')
  expect(resolveSuperoneHome()).toBe(root)
  expect(resolveNodeHome()).toBe(join(root, 'node'))
  expect(resolveHarnessHomeRoot()).toBe(join(root, 'harness'))
  expect(DEFAULT_BIND_PORT).toBe(variant === 'alpha' ? 7790 : 7788)
  expect(SYSTEMD_USER_UNIT_NAME).toBe(variant === 'alpha' ? 'superone-alpha.service' : 'superone.service')
  vi.stubEnv('SUPERONE_HOME', '/custom data')
  expect(resolveNodeHome()).toBe('/custom data/node')
  expect(renderSystemdUserUnit({ execStart: '/bin/superone', nodeHome: '/custom data/node', home: homedir() })).toContain('Environment="SUPERONE_HOME=/custom data"')
})
