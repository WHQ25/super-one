import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isPluginEnabled, setPluginEnabled } from './plugins-manage'

let home: string
let project: string
const opts = () => ({ homeDir: home })
const userSettings = () => join(home, '.claude', 'settings.json')
const projectSettings = () => join(project, '.claude', 'settings.json')
const localSettings = () => join(project, '.claude', 'settings.local.json')
const write = (file: string, data: unknown) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(data))
}
const read = (file: string) => JSON.parse(readFileSync(file, 'utf-8'))

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plug-home-'))
  project = mkdtempSync(join(tmpdir(), 'plug-proj-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

it('falls back to the manifest default with no explicit value', () => {
  expect(isPluginEnabled(project, 'demo@mp', undefined, opts())).toBe(true)
  expect(isPluginEnabled(project, 'demo@mp', false, opts())).toBe(false)
})

it('takes the highest-precedence explicit value (user < project < local)', () => {
  write(userSettings(), { enabledPlugins: { 'demo@mp': false } })
  expect(isPluginEnabled(project, 'demo@mp', true, opts())).toBe(false)
  write(projectSettings(), { enabledPlugins: { 'demo@mp': ['>=1.0'] } })
  expect(isPluginEnabled(project, 'demo@mp', true, opts())).toBe(true)
  write(localSettings(), { enabledPlugins: { 'demo@mp': false } })
  expect(isPluginEnabled(project, 'demo@mp', true, opts())).toBe(false)
})

it('writes the file that decides, keeping other settings', () => {
  write(userSettings(), { theme: 'dark' })
  write(localSettings(), { enabledPlugins: { 'demo@mp': false, 'other@mp': true } })
  setPluginEnabled(project, 'demo@mp', 'user', true, opts())
  expect(read(localSettings()).enabledPlugins).toEqual({ 'demo@mp': true, 'other@mp': true })
  expect(read(userSettings())).toEqual({ theme: 'dark' })
  expect(isPluginEnabled(project, 'demo@mp', true, opts())).toBe(true)
})

it('writes the plugin scope’s file when nothing decides yet', () => {
  write(userSettings(), { theme: 'dark' })
  setPluginEnabled(project, 'demo@mp', 'user', false, opts())
  expect(read(userSettings())).toEqual({ theme: 'dark', enabledPlugins: { 'demo@mp': false } })
  setPluginEnabled(project, 'proj@mp', 'project', false, opts())
  expect(read(projectSettings()).enabledPlugins).toEqual({ 'proj@mp': false })
})
