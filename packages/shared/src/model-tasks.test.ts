import { describe, expect, it } from 'vitest'
import { modelTasks } from './model-tasks'
import type { CatalogModel } from './model-catalog-types'

function model(input: string[], output: string[]): CatalogModel {
  return {
    id: 'm',
    name: 'M',
    providerId: 'p',
    inputModalities: input as CatalogModel['inputModalities'],
    outputModalities: output as CatalogModel['outputModalities'],
    reasoning: false,
    toolCall: false,
    attachment: false,
  }
}

describe('modelTasks', () => {
  it('classifies a text LLM as chat', () => {
    expect(modelTasks(model(['text', 'image'], ['text']))).toEqual(['chat'])
  })

  it('classifies an image generator as image', () => {
    expect(modelTasks(model(['text'], ['image']))).toEqual(['image'])
  })

  it('classifies a video generator as video', () => {
    expect(modelTasks(model(['text'], ['video']))).toEqual(['video'])
  })

  it('classifies audio output as tts', () => {
    expect(modelTasks(model(['text'], ['audio']))).toEqual(['tts'])
  })

  it('classifies audio-in text-out as asr, not chat', () => {
    expect(modelTasks(model(['audio'], ['text']))).toEqual(['asr'])
  })

  it('does not mark audio-out models as asr', () => {
    expect(modelTasks(model(['audio', 'text'], ['audio', 'text']))).toEqual(['chat', 'tts'])
  })

  it('returns no task for embedding-style models', () => {
    expect(modelTasks(model(['text'], []))).toEqual([])
  })
})
