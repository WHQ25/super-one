import { describe, expect, it } from 'vitest'
import { collectGeneratedImages, coordinationToolBody, getToolDisplay, getToolVerb, isHiddenToolBlock } from './tool-display'
import type { ContentBlock } from '@superone/shared/agent-types'

describe('getToolVerb', () => {
  it('uses the same live Bash label as the desktop terminal row', () => {
    expect(getToolVerb('Bash')).toBe('Running')
  })

  it('treats Grok qualified MCP names as Running, same as mcp__ rows', () => {
    expect(getToolVerb('mcp__GitHub__list_issues')).toBe('Running')
    expect(getToolVerb('GitHub__list_issues')).toBe('Running')
  })
})

describe('native widget_show results — hide/collect contract', () => {
  const tool = 'mcp__superone__widget_show'
  const gallery = JSON.stringify({
    kind: 'native', nativeType: 'image-gallery', title: 'g',
    images: [{ id: 'g-0', type: 'image_generation', status: 'completed', savedPath: '/tmp/a.png' }],
  })
  const previewer = JSON.stringify({
    kind: 'native', nativeType: 'files-previewer', title: 'p', root: '/repo',
    files: [{ path: 'a.png', absolutePath: '/repo/a.png', name: 'a.png', kind: 'image' }],
  })
  const call = (id: string): ContentBlock => ({ type: 'tool_use', toolUseId: id, toolName: tool, input: '{}' })

  it('hides a gallery result (the turn-end gallery shows it) but keeps a previewer row (it renders in place)', () => {
    expect(isHiddenToolBlock(tool, gallery)).toBe(true)
    expect(isHiddenToolBlock(tool, previewer)).toBe(false)
  })

  it('collects gallery items at turn end and ignores a previewer, so the block is never drawn twice', () => {
    const results = new Map([['g', gallery], ['p', previewer]])
    const items = collectGeneratedImages([call('g'), call('p')], results)
    expect(items.map((i) => i.savedPath)).toEqual(['/tmp/a.png'])
  })
})

describe('coordination tool rows', () => {
  const receipt = '{"success":true,"message":"Message queued for delivery to worker at its next tool round."}'

  it('opens a sent message on the words that were sent, not the delivery receipt', () => {
    expect(coordinationToolBody('SendMessage', { to: 'worker', message: 'Run the suite.' }, receipt)).toBe('Run the suite.')
    expect(coordinationToolBody('SendMessage', {}, receipt)).toBe('Message queued for delivery to worker at its next tool round.')
    expect(coordinationToolBody('SendMessage', {}, 'not json')).toBeNull()
    expect(coordinationToolBody('Bash', { message: 'x' }, receipt)).toBeNull()
  })

  it('draws worktree moves with the branch glyph and a path relative to the session', () => {
    expect(getToolDisplay('EnterWorktree', { path: '/repo/.claude/worktrees/probe' }, '/repo')).toEqual({ icon: 'git-branch', summary: '.claude/worktrees/probe' })
    expect(getToolDisplay('ExitWorktree', { action: 'keep' })).toEqual({ icon: 'git-branch', summary: 'keep' })
  })
})

describe('session timer tool rows', () => {
  it('summarizes Claude cron and wakeup calls from their input', () => {
    expect(getToolDisplay('CronCreate', { cron: '*/30 * * * *', prompt: 'check CI', recurring: true })).toEqual({ icon: 'clock', summary: '*/30 * * * * · check CI' })
    expect(getToolDisplay('CronCreate', { cron: '0 9 17 10 *', prompt: 'remind me', recurring: false }).summary).toBe('0 9 17 10 * · once · remind me')
    expect(getToolDisplay('ScheduleWakeup', { delaySeconds: 1200, reason: 'watching CI', prompt: '<<autonomous-loop-dynamic>>' }).summary).toBe('in 20m 0s · watching CI')
    expect(getToolDisplay('ScheduleWakeup', { stop: true }).summary).toBe('stop loop')
    expect(getToolDisplay('CronDelete', { id: '8e709dd2' })).toEqual({ icon: 'clock', summary: '8e709dd2' })
    expect(getToolDisplay('CronList', {})).toEqual({ icon: 'clock', summary: '' })
  })

  it('summarizes Grok scheduler calls with the same row shape', () => {
    expect(getToolDisplay('SchedulerCreate', { interval: '10m', prompt: 'poll deploy' }).summary).toBe('every 10m · poll deploy')
    expect(getToolDisplay('SchedulerCreate', { task_id: 'job-1', interval: '1h' }).summary).toBe('job-1 · every 1h')
    expect(getToolDisplay('SchedulerDelete', { id: 'job-1' }).summary).toBe('job-1')
  })

  it('shows a progress verb while the call streams', () => {
    expect(getToolVerb('CronCreate')).toBe('Scheduling')
    expect(getToolVerb('ScheduleWakeup')).toBe('Scheduling wakeup')
  })
})
