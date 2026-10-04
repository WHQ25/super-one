import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readPluginUserConfig, savePluginUserConfig } from './plugins-manage'

let home: string
const opts = () => ({ homeDir: home })
const settings = () => join(home, '.claude', 'settings.json')

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plug-cfg-'))
  const installPath = join(home, 'cache', 'demo')
  mkdirSync(join(installPath, '.claude-plugin'), { recursive: true })
  writeFileSync(join(installPath, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'demo',
    description: '',
    userConfig: {
      region: { type: 'string', title: 'Region', description: 'Where', options: ['us', 'eu'], required: true },
      limit: { type: 'number', title: 'Limit', description: 'Max', min: 1, max: 9, default: 3 },
      verbose: { type: 'boolean', title: 'Verbose', description: '' },
      token: { type: 'string', title: 'Token', description: '', sensitive: true },
    },
  }))
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 1, plugins: { 'demo@mp': [{ scope: 'user', installPath }] } }))
  writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), '{}')
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

it('maps userConfig to a JSON schema and lists sensitive options apart', () => {
  const config = readPluginUserConfig('', 'demo@mp', opts())!
  expect(config.schema.properties.region).toMatchObject({ type: 'string', enum: ['us', 'eu'], title: 'Region' })
  expect(config.schema.properties.limit).toMatchObject({ type: 'number', minimum: 1, maximum: 9, default: 3 })
  expect(config.schema.properties.verbose).toMatchObject({ type: 'boolean' })
  expect(config.schema.properties.token).toBeUndefined()
  expect(config.schema.required).toEqual(['region'])
  expect(config.sensitive).toEqual(['token'])
})

it('saves values under pluginConfigs[id].options, keeping other settings', () => {
  writeFileSync(settings(), JSON.stringify({ theme: 'dark', pluginConfigs: { 'demo@mp': { mcpServers: { s: { a: '1' } } } } }))
  savePluginUserConfig('demo@mp', { region: 'eu', limit: 5 }, opts())
  expect(JSON.parse(readFileSync(settings(), 'utf-8'))).toEqual({
    theme: 'dark',
    pluginConfigs: { 'demo@mp': { mcpServers: { s: { a: '1' } }, options: { region: 'eu', limit: 5 } } },
  })
  expect(readPluginUserConfig('', 'demo@mp', opts())!.values).toEqual({ region: 'eu', limit: 5 })
})
