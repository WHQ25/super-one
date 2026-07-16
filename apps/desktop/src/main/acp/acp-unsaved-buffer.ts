import { resolve } from 'node:path'

const buffers = new Map<string, string>()

function keyOf(filePath: string): string {
  return resolve(filePath)
}

export function setUnsavedBuffer(filePath: string, content: string | null): void {
  const key = keyOf(filePath)
  if (content == null) buffers.delete(key)
  else buffers.set(key, content)
}

export function getUnsavedBuffer(filePath: string): string | null {
  return buffers.get(keyOf(filePath)) ?? null
}

export function clearUnsavedBuffers(): void {
  buffers.clear()
}

export function listUnsavedBuffers(): string[] {
  return [...buffers.keys()]
}
