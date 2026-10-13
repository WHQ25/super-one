import { describe, expect, it } from 'vitest'
import { extractPartialToolInput } from './partial-tool-input'

describe('native streaming input previews', () => {
  it('normalizes complete keys while allowing unfinished string values', () => {
    expect(extractPartialToolInput('{"filePath":"a.ts","oldString":"old","newString":"ne', 'Edit')).toEqual({ file_path: 'a.ts', old_string: 'old', new_string: 'ne' })
    expect(extractPartialToolInput('{"path":"a.ts', 'Read')).toEqual({ file_path: 'a.ts' })
    expect(extractPartialToolInput('{"patchText":"*** Begin Patch\\n*** Add File: a.ts\\n+hel', 'Patch')).toEqual({ patchText: '*** Begin Patch\n*** Add File: a.ts\n+hel' })
    expect(extractPartialToolInput('{"code":"return 4', 'CodeExecution')).toEqual({ code: 'return 4' })
  })
  it('accepts both plain shell fragments and native JSON arguments', () => {
    expect(extractPartialToolInput('git stat', 'Bash')).toEqual({ command: 'git stat' })
    expect(extractPartialToolInput('{"command":"git stat', 'Bash')).toEqual({ command: 'git stat' })
  })
})
