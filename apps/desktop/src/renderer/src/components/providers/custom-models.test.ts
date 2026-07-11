import { describe, expect, it } from 'vitest'
import type { EndpointModel, Plan } from '@superone/shared/platform-registry'
import {
  endpointsSupportedTasks,
  listCustomModels,
  removeCustomModel,
  upsertCustomModel,
} from './custom-models'

const plan: Plan = {
  id: 'api',
  name: 'API',
  auth: 'api-key',
  endpoints: [
    { id: 'chat', baseUrl: 'https://x/chat', protocols: ['anthropic-messages'] },
    { id: 'img', baseUrl: 'https://x/img', protocols: ['openai-images'] },
    { id: 'audio', baseUrl: 'https://x/audio', protocols: ['openai-audio'] },
  ],
}

describe('custom model routing', () => {
  it('writes a single-task model only to the endpoints serving that task', () => {
    const out = upsertCustomModel({}, plan, { id: 'm1', name: 'M1', tasks: ['chat'] })
    expect(Object.keys(out)).toEqual(['chat'])
    expect(out.chat.models).toEqual([{ id: 'm1', name: 'M1', tasks: ['chat'] }])
  })

  it('spreads a multi-task model across endpoints, storing per-endpoint the served subset', () => {
    const out = upsertCustomModel({}, plan, { id: 'm2', tasks: ['chat', 'image', 'tts'] })
    expect(out.chat.models).toEqual([{ id: 'm2', name: undefined, tasks: ['chat'] }])
    expect(out.img.models).toEqual([{ id: 'm2', name: undefined, tasks: ['image'] }])
    expect(out.audio.models).toEqual([{ id: 'm2', name: undefined, tasks: ['tts'] }])
  })

  it('replaces an existing id, dropping it from endpoints no longer served', () => {
    const first = upsertCustomModel({}, plan, { id: 'm3', tasks: ['chat', 'image'] })
    const second = upsertCustomModel(first, plan, { id: 'm3', tasks: ['image'] })
    expect(second.chat).toBeUndefined()
    expect(second.img.models).toEqual([{ id: 'm3', name: undefined, tasks: ['image'] }])
  })

  it('preserves catalog-enabled models on an endpoint when adding a custom one', () => {
    const catalog: EndpointModel = { id: 'cat', name: 'Catalog', tasks: ['chat'] }
    const out = upsertCustomModel({ chat: { models: [catalog] } }, plan, { id: 'm4', tasks: ['chat'] })
    expect(out.chat.models).toEqual([catalog, { id: 'm4', name: undefined, tasks: ['chat'] }])
  })

  it('removes a model from every endpoint and prunes empty overrides', () => {
    const added = upsertCustomModel({}, plan, { id: 'm5', tasks: ['chat', 'image'] })
    const removed = removeCustomModel(added, 'm5')
    expect(removed).toEqual({})
  })

  it('keeps other override fields when pruning a removed model', () => {
    const start = upsertCustomModel({ chat: { baseUrl: 'https://y' } }, plan, { id: 'm6', tasks: ['chat'] })
    const removed = removeCustomModel(start, 'm6')
    expect(removed.chat).toEqual({ baseUrl: 'https://y' })
  })
})

describe('listCustomModels', () => {
  it('dedupes by id and unions tasks across endpoints', () => {
    const overrides = upsertCustomModel({}, plan, { id: 'm7', name: 'M7', tasks: ['chat', 'image'] })
    expect(listCustomModels(overrides)).toEqual([{ id: 'm7', name: 'M7', tasks: ['chat', 'image'] }])
  })

  it('excludes ids that belong to the catalog pool', () => {
    const overrides = {
      chat: { models: [{ id: 'cat', tasks: ['chat' as const] }, { id: 'custom', tasks: ['chat' as const] }] },
    }
    const isCatalog = (_ep: string, id: string) => id === 'cat'
    expect(listCustomModels(overrides, isCatalog)).toEqual([{ id: 'custom', name: undefined, tasks: ['chat'] }])
  })
})

describe('endpointsSupportedTasks', () => {
  it('returns the union of served tasks in canonical order', () => {
    expect(endpointsSupportedTasks(plan.endpoints)).toEqual(['chat', 'image', 'tts', 'asr'])
  })
})
