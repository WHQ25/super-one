import { describe, expect, it } from 'vitest'
import type { ModelListItem } from '@cursor/sdk'
import {
  buildCursorModelSelection,
  defaultCursorModelParams,
  findCursorEffortParam,
  isCursorEffortParam,
  isCursorFastParam,
  mapCursorModel,
  normalizeEffortValue,
  parseCursorContextWindow,
  resolveCursorSelectedContextWindow,
} from './cursor-model-selection'

describe('cursor-model-selection', () => {
  it('detects fast and effort parameters (not thinking boolean)', () => {
    expect(isCursorFastParam({ id: 'fast' })).toBe(true)
    expect(isCursorEffortParam({ id: 'reasoning', displayName: 'Effort' })).toBe(true)
    expect(isCursorEffortParam({ id: 'effort' })).toBe(true)
    expect(isCursorEffortParam({ id: 'thinking' })).toBe(false)
    expect(isCursorEffortParam({ id: 'optimize_for' })).toBe(false)
  })

  it('maps composer catalog row with fast param', () => {
    const item: ModelListItem = {
      id: 'composer-2.5',
      displayName: 'Composer 2.5',
      description: 'Default',
      parameters: [{
        id: 'fast',
        displayName: 'Fast',
        values: [{ value: 'false' }, { value: 'true', displayName: 'Fast' }],
      }],
    }
    const mapped = mapCursorModel(item)
    expect(mapped.supportsFastMode).toBe(true)
    expect(mapped.supportedEffortLevels).toBeUndefined()
    expect(mapped.parameters?.[0]?.id).toBe('fast')
  })

  it('prefers effort over thinking for Opus-style catalogs', () => {
    const mapped = mapCursorModel({
      id: 'claude-opus-5',
      displayName: 'Opus 5',
      parameters: [
        { id: 'thinking', values: [{ value: 'false' }, { value: 'true' }] },
        { id: 'context', values: [{ value: '300k' }, { value: '1m' }] },
        { id: 'effort', values: [
          { value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }, { value: 'max' },
        ] },
        { id: 'fast', values: [{ value: 'false' }, { value: 'true' }] },
      ],
    })
    expect(findCursorEffortParam(mapped.parameters ?? [])?.id).toBe('effort')
    expect(mapped.supportsEffort).toBe(true)
    expect(mapped.supportsFastMode).toBe(true)
    expect(mapped.supportedEffortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('maps effort values into SuperOne levels', () => {
    expect(normalizeEffortValue('HIGH')).toBe('high')
    expect(normalizeEffortValue('extra-high')).toBe('xhigh')
    const mapped = mapCursorModel({
      id: 'opus',
      displayName: 'Opus',
      parameters: [{
        id: 'effort',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
        ],
      }],
    })
    expect(mapped.supportsEffort).toBe(true)
    expect(mapped.supportedEffortLevels).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('builds ModelSelection with fast + effort + default optimize_for', () => {
    const model = mapCursorModel({
      id: 'auto-smart',
      displayName: 'Router',
      parameters: [
        {
          id: 'optimize_for',
          values: [
            { value: 'cost' },
            { value: 'balanced' },
            { value: 'intelligence' },
          ],
        },
        {
          id: 'fast',
          values: [{ value: 'false' }, { value: 'true' }],
        },
        {
          id: 'effort',
          values: [{ value: 'low' }, { value: 'high' }],
        },
      ],
    })
    expect(buildCursorModelSelection({
      modelId: 'auto-smart',
      model,
      effort: 'high',
      fast: true,
    })).toEqual({
      id: 'auto-smart',
      params: [
        { id: 'fast', value: 'true' },
        { id: 'effort', value: 'high' },
        { id: 'optimize_for', value: 'balanced' },
      ],
    })
  })

  it('builds ModelSelection from full params map', () => {
    const model = mapCursorModel({
      id: 'claude-opus-5',
      displayName: 'Opus 5',
      parameters: [
        { id: 'thinking', values: [{ value: 'false' }, { value: 'true' }] },
        { id: 'context', values: [{ value: '300k' }, { value: '1m' }] },
        { id: 'effort', values: [
          { value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }, { value: 'max' },
        ] },
        { id: 'fast', values: [{ value: 'false' }, { value: 'true' }] },
      ],
    })
    expect(buildCursorModelSelection({
      modelId: 'claude-opus-5',
      model,
      params: {
        thinking: 'true',
        context: '1m',
        effort: 'max',
        fast: 'true',
      },
    })).toEqual({
      id: 'claude-opus-5',
      params: [
        { id: 'thinking', value: 'true' },
        { id: 'context', value: '1m' },
        { id: 'effort', value: 'max' },
        { id: 'fast', value: 'true' },
      ],
    })
  })

  it('defaults params to balanced / medium / false', () => {
    const model = mapCursorModel({
      id: 'auto',
      displayName: 'Auto',
      parameters: [
        {
          id: 'optimize_for',
          values: [{ value: 'cost' }, { value: 'balanced' }, { value: 'intelligence' }],
        },
        { id: 'fast', values: [{ value: 'false' }, { value: 'true' }] },
        { id: 'effort', values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }] },
      ],
    })
    expect(defaultCursorModelParams(model)).toEqual({
      optimize_for: 'balanced',
      fast: 'false',
      effort: 'medium',
    })
  })

  it('parses context values into token counts', () => {
    expect(parseCursorContextWindow('300k')).toBe(300_000)
    expect(parseCursorContextWindow('1m')).toBe(1_000_000)
    expect(parseCursorContextWindow('200000')).toBe(200_000)
    expect(parseCursorContextWindow('auto')).toBeNull()
    expect(parseCursorContextWindow(undefined)).toBeNull()
  })

  it('skips auto when defaulting the context param', () => {
    const model = mapCursorModel({
      id: 'claude-opus-5',
      displayName: 'Opus 5',
      parameters: [
        { id: 'context', values: [{ value: 'auto' }, { value: '300k' }, { value: '1m' }] },
      ],
    })
    expect(defaultCursorModelParams(model)).toEqual({ context: '300k' })
  })

  it('resolves selected context window from param then first parseable catalog value', () => {
    const model = mapCursorModel({
      id: 'claude-opus-5',
      displayName: 'Opus 5',
      parameters: [
        { id: 'context', values: [{ value: 'auto' }, { value: '300k' }, { value: '1m' }] },
      ],
    })
    expect(resolveCursorSelectedContextWindow('1m', model)).toBe(1_000_000)
    expect(resolveCursorSelectedContextWindow('auto', model)).toBe(300_000)
    expect(resolveCursorSelectedContextWindow(undefined, model)).toBe(300_000)
    expect(resolveCursorSelectedContextWindow('auto', null)).toBeNull()
  })

  it('omits params when catalog has none and no fast flag', () => {
    expect(buildCursorModelSelection({ modelId: 'plain' })).toEqual({ id: 'plain' })
  })
})
