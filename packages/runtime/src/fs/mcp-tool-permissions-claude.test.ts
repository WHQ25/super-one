import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeMcpToolRuleName } from '@superone/shared/tool-ui'
import { listClaudeMcpToolPermissions, setClaudeMcpToolPermission } from './mcp-tool-permissions-claude'

let root: string
let home: string
let cwd: string
const userFile = () => join(home, '.claude', 'settings.json')
const projectFile = () => join(cwd, '.claude', 'settings.json')
const localFile = () => join(cwd, '.claude', 'settings.local.json')

function write(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data))
}

function read(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf-8'))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mcp-tool-perm-'))
  home = join(root, 'home')
  cwd = join(root, 'project')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('claudeMcpToolRuleName', () => {
  it('replaces characters Claude Code does not keep in MCP names', () => {
    expect(claudeMcpToolRuleName('my.server', 'read file')).toBe('mcp__my_server__read_file')
  })

  it('collapses and trims underscores for claude.ai connectors', () => {
    expect(claudeMcpToolRuleName('claude.ai Claude Docs', 'batch')).toBe('mcp__claude_ai_Claude_Docs__batch')
    expect(claudeMcpToolRuleName('claude.ai  Gmail (work)', 'search')).toBe('mcp__claude_ai_Gmail_work__search')
  })
})

describe('listClaudeMcpToolPermissions', () => {
  it('lets the strictest list win across settings layers', () => {
    write(userFile(), { permissions: { allow: ['mcp__fs__read', 'mcp__fs__write', 'Bash(ls)'] } })
    write(projectFile(), { permissions: { ask: ['mcp__fs__write'] } })
    write(localFile(), { permissions: { deny: ['mcp__fs__read', 42] } })
    expect(listClaudeMcpToolPermissions(cwd, { homeDir: home })).toEqual({
      mcp__fs__read: 'deny',
      mcp__fs__write: 'ask',
    })
  })

  it('reads only user settings without a project', () => {
    write(userFile(), { permissions: { ask: ['mcp__fs__read'] } })
    expect(listClaudeMcpToolPermissions('', { homeDir: home })).toEqual({ mcp__fs__read: 'ask' })
  })
})

describe('setClaudeMcpToolPermission', () => {
  it('writes user-scope rules to user settings and keeps other keys', () => {
    write(userFile(), { model: 'opus', permissions: { allow: ['Bash(ls)'], defaultMode: 'default' } })
    setClaudeMcpToolPermission(cwd, 'fs', 'read', 'ask', 'user', { homeDir: home })
    expect(read(userFile())).toEqual({
      model: 'opus',
      permissions: { allow: ['Bash(ls)'], defaultMode: 'default', ask: ['mcp__fs__read'] },
    })
  })

  it('writes project-scope rules to local settings and removes the rule from every other layer', () => {
    write(userFile(), { permissions: { deny: ['mcp__repo__run'] } })
    write(projectFile(), { permissions: { ask: ['mcp__repo__run', 'mcp__repo__other'] } })
    setClaudeMcpToolPermission(cwd, 'repo', 'run', 'allow', 'project', { homeDir: home })
    expect(read(userFile())).toEqual({ permissions: { deny: [] } })
    expect(read(projectFile())).toEqual({ permissions: { ask: ['mcp__repo__other'] } })
    expect(read(localFile())).toEqual({ permissions: { allow: ['mcp__repo__run'] } })
    expect(listClaudeMcpToolPermissions(cwd, { homeDir: home })).toEqual({
      mcp__repo__run: 'allow',
      mcp__repo__other: 'ask',
    })
  })

  it('clears the rule with null and leaves untouched files alone', () => {
    write(userFile(), { permissions: { deny: ['mcp__fs__read'] } })
    setClaudeMcpToolPermission(cwd, 'fs', 'read', null, 'user', { homeDir: home })
    expect(read(userFile())).toEqual({ permissions: { deny: [] } })
    expect(() => read(localFile())).toThrow()
    expect(listClaudeMcpToolPermissions(cwd, { homeDir: home })).toEqual({})
  })

  it('writes claude.ai connector rules to user settings under the normalized name', () => {
    setClaudeMcpToolPermission(cwd, 'claude.ai Gmail', 'search_threads', 'deny', 'claudeai', { homeDir: home })
    expect(read(userFile())).toEqual({ permissions: { deny: ['mcp__claude_ai_Gmail__search_threads'] } })
  })
})
