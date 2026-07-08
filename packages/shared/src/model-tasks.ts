import type { CapabilityTask } from './agent-types'
import type { CatalogModel } from './model-catalog-types'

export const MODEL_TASK_ORDER: CapabilityTask[] = ['chat', 'image', 'video', 'tts', 'asr']

export function modelTasks(model: CatalogModel): CapabilityTask[] {
  const input = new Set(model.inputModalities)
  const output = new Set(model.outputModalities)
  const tasks: CapabilityTask[] = []
  if (input.has('text') && output.has('text')) tasks.push('chat')
  if (output.has('image')) tasks.push('image')
  if (output.has('video')) tasks.push('video')
  if (output.has('audio')) tasks.push('tts')
  if (input.has('audio') && output.has('text') && !output.has('audio')) tasks.push('asr')
  return tasks
}
