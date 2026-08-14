import { describe, expect, it } from 'vitest'
import {
  markTerminalBoundSlashCommands,
  readTerminalSlashCommands,
  readTerminalSlashCommandsFromInitMessage,
  slashCommandKey,
} from './slash-commands'
import type { SlashCommandInfo } from './agent-types'

function cmd(name: string, extra?: Partial<SlashCommandInfo>): SlashCommandInfo {
  return { name, description: '', argumentHint: '', isSkill: false, ...extra }
}

describe('slashCommandKey', () => {
  it('strips a single leading slash', () => {
    expect(slashCommandKey('/exit')).toBe('exit')
    expect(slashCommandKey('exit')).toBe('exit')
  })
})

describe('readTerminalSlashCommands', () => {
  it('keeps non-empty string names and drops the rest', () => {
    expect(readTerminalSlashCommands(['exit', '/statusline', '', 1, null])).toEqual(['exit', '/statusline'])
  })

  it('returns undefined for missing or empty input', () => {
    expect(readTerminalSlashCommands(undefined)).toBeUndefined()
    expect(readTerminalSlashCommands([])).toBeUndefined()
    expect(readTerminalSlashCommands('exit')).toBeUndefined()
  })
})

describe('readTerminalSlashCommandsFromInitMessage', () => {
  it('reads terminal_slash_commands from a system/init frame', () => {
    expect(readTerminalSlashCommandsFromInitMessage({
      type: 'system',
      subtype: 'init',
      terminal_slash_commands: ['exit', 'statusline'],
    })).toEqual(['exit', 'statusline'])
  })

  it('ignores non-init frames', () => {
    expect(readTerminalSlashCommandsFromInitMessage({
      type: 'system',
      subtype: 'status',
      terminal_slash_commands: ['exit'],
    })).toBeUndefined()
    expect(readTerminalSlashCommandsFromInitMessage({ type: 'result' })).toBeUndefined()
  })
})

describe('markTerminalBoundSlashCommands', () => {
  it('tags matching names with or without a leading slash', () => {
    const marked = markTerminalBoundSlashCommands(
      [cmd('exit'), cmd('help'), cmd('statusline')],
      ['/exit', 'statusline'],
    )
    expect(marked.map((c) => [c.name, c.terminalBound])).toEqual([
      ['exit', true],
      ['help', undefined],
      ['statusline', true],
    ])
  })

  it('returns the original array when nothing is tagged', () => {
    const commands = [cmd('help')]
    expect(markTerminalBoundSlashCommands(commands, undefined)).toBe(commands)
    expect(markTerminalBoundSlashCommands(commands, [])).toBe(commands)
    expect(markTerminalBoundSlashCommands(commands, ['exit'])).toBe(commands)
  })
})
