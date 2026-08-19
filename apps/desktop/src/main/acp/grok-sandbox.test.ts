/**
 * The precedence encoded here was measured against grok 1.0.5, not inferred from
 * its docs (which document only the `--sandbox` flag). Each case names the
 * observation it pins, so a future grok release that changes behaviour fails here
 * instead of silently making the status-bar chip lie.
 */

import { describe, expect, it } from 'vitest'
import { resolveGrokSandbox } from './grok-sandbox'

const NO_CONFIG = () => null
const HOME = '/home/tester'

function configAt(expectedPath: string, text: string) {
  return (path: string) => (path === expectedPath ? text : null)
}

describe('resolveGrokSandbox', () => {
  it('reports off when neither env nor config selects a profile', () => {
    expect(resolveGrokSandbox({}, NO_CONFIG)).toEqual({ enabled: false, autoAllowBash: false })
  })

  it('treats an explicit off profile as no sandbox', () => {
    expect(resolveGrokSandbox({ GROK_SANDBOX: 'off' }, NO_CONFIG))
      .toEqual({ enabled: false, autoAllowBash: false })
  })

  it.each(['workspace', 'read-only', 'strict', 'devbox'])(
    'treats profile %s as sandboxed',
    (profile) => {
      expect(resolveGrokSandbox({ GROK_SANDBOX: profile }, NO_CONFIG).enabled).toBe(true)
    },
  )

  it('accepts GROK_SANDBOX_PROFILE as an alias', () => {
    expect(resolveGrokSandbox({ GROK_SANDBOX_PROFILE: 'strict' }, NO_CONFIG).enabled).toBe(true)
  })

  it('reads the profile from the global config when env sets none', () => {
    const read = configAt(`${HOME}/.grok/config.toml`, '[sandbox]\nprofile = "workspace"\n')
    expect(resolveGrokSandbox({ GROK_HOME: `${HOME}/.grok` }, read).enabled).toBe(true)
  })

  // Verified against grok 1.0.5: env `workspace` beat config `read-only`.
  it('lets env win over the config file', () => {
    const read = configAt(`${HOME}/.grok/config.toml`, '[sandbox]\nprofile = "off"\n')
    const env = { GROK_HOME: `${HOME}/.grok`, GROK_SANDBOX: 'workspace' }
    expect(resolveGrokSandbox(env, read).enabled).toBe(true)
  })

  it('honours GROK_HOME when locating the config', () => {
    const read = configAt('/custom/home/config.toml', '[sandbox]\nprofile = "strict"\n')
    expect(resolveGrokSandbox({ GROK_HOME: '/custom/home' }, read).enabled).toBe(true)
    // Same config text at the default location must not be found.
    expect(resolveGrokSandbox({}, read).enabled).toBe(false)
  })

  it('reports off for a config with no sandbox section', () => {
    const read = configAt(`${HOME}/.grok/config.toml`, '[ui]\nyolo = false\n')
    expect(resolveGrokSandbox({ GROK_HOME: `${HOME}/.grok` }, read).enabled).toBe(false)
  })

  it('reports off rather than guessing when the config will not parse', () => {
    const read = configAt(`${HOME}/.grok/config.toml`, 'this is not = = toml')
    expect(resolveGrokSandbox({ GROK_HOME: `${HOME}/.grok` }, read))
      .toEqual({ enabled: false, autoAllowBash: false })
  })

  describe('autoAllowBash', () => {
    it.each(['1', 'true', 'YES'])('accepts %s from the environment', (flag) => {
      const env = { GROK_SANDBOX: 'workspace', GROK_SANDBOX_AUTO_ALLOW_BASH: flag }
      expect(resolveGrokSandbox(env, NO_CONFIG).autoAllowBash).toBe(true)
    })

    it('treats an unrecognised value as off', () => {
      const env = { GROK_SANDBOX: 'workspace', GROK_SANDBOX_AUTO_ALLOW_BASH: 'maybe' }
      expect(resolveGrokSandbox(env, NO_CONFIG).autoAllowBash).toBe(false)
    })

    it('reads it from the config file', () => {
      const read = configAt(
        `${HOME}/.grok/config.toml`,
        '[sandbox]\nprofile = "workspace"\nauto_allow_bash = true\n',
      )
      expect(resolveGrokSandbox({ GROK_HOME: `${HOME}/.grok` }, read).autoAllowBash).toBe(true)
    })

    it('lets an explicit env false override the config', () => {
      const read = configAt(
        `${HOME}/.grok/config.toml`,
        '[sandbox]\nprofile = "workspace"\nauto_allow_bash = true\n',
      )
      const env = { GROK_HOME: `${HOME}/.grok`, GROK_SANDBOX_AUTO_ALLOW_BASH: '0' }
      expect(resolveGrokSandbox(env, read).autoAllowBash).toBe(false)
    })

    // It relaxes bash prompting inside a sandbox; with no sandbox there is nothing
    // to relax, and reporting `auto` would imply confinement that is not there.
    it('stays off when there is no sandbox to relax', () => {
      const env = { GROK_SANDBOX_AUTO_ALLOW_BASH: 'true' }
      expect(resolveGrokSandbox(env, NO_CONFIG)).toEqual({ enabled: false, autoAllowBash: false })
    })
  })
})
