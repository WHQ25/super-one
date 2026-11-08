import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  GENERATE_SPEECH_DESCRIPTION,
  LIST_SPEECH_PROVIDERS_DESCRIPTION,
  SPEECH_VOICE_FIELD_DESCRIPTION,
  TRANSCRIBE_SPEECH_DESCRIPTION,
} from '@superone/shared/superone-tool-descriptions'
import { producerDir } from '../media-output-paths'
import { listSpeechProviders } from '../speech/providers'
import { synthesizeSpeech, transcribeAudio } from '../speech/service'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

/** Agent synthesis stops here and asks for a split. Read-aloud truncates instead. */
export const SPEECH_TEXT_LIMIT = 5000
const TRANSCRIBE_BYTE_LIMIT = 25 * 1024 * 1024

export interface ListSpeechProvidersArgs {
  category?: 'tts' | 'asr'
}

export interface GenerateSpeechArgs {
  text: string
  provider?: string
  model?: string
  voice?: string
}

export interface TranscribeSpeechArgs {
  path: string
  provider?: string
  model?: string
  language?: string
}

function toolError(error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
      },
    ],
    isError: true as const,
  }
}

function toolResult(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
}

export function listSpeechProvidersHandler(args: ListSpeechProvidersArgs = {}) {
  const providers = listSpeechProviders(args.category).map((provider) => ({
    id: provider.id,
    label: provider.label,
    platformId: provider.platformId,
    kind: provider.kind,
    task: provider.task,
    defaultModel: provider.defaultModel,
    defaultVoice: provider.defaultVoice,
    models: provider.models.map((model) => ({ id: model.id, label: model.name ?? model.id })),
  }))
  return toolResult({ providers })
}

export async function generateSpeechToolHandler(args: GenerateSpeechArgs, deps: BuiltInSuperoneToolDeps) {
  try {
    const text = args.text?.trim() ?? ''
    if (!text) return toolError(new Error('Text is required'))
    if (text.length > SPEECH_TEXT_LIMIT) {
      return toolError(new Error(
        `Text is ${text.length} characters. Split it into pieces under ${SPEECH_TEXT_LIMIT} characters and call speech_generate again.`,
      ))
    }
    const audio = await synthesizeSpeech({
      text,
      credentialId: args.provider,
      modelId: args.model,
      voice: args.voice,
      abortSignal: deps.signal,
    })
    const dir = producerDir(deps.sessionId, 'agent')
    mkdirSync(dir, { recursive: true })
    const savedPath = join(dir, `speech-${randomUUID()}.mp3`)
    writeFileSync(savedPath, audio.bytes)
    return toolResult({
      status: 'generated',
      savedPath,
      mediaType: audio.mediaType,
      provider: audio.providerId,
      model: audio.model,
      voice: audio.voice,
    })
  } catch (error) {
    return toolError(error)
  }
}

export async function transcribeSpeechToolHandler(args: TranscribeSpeechArgs, deps: BuiltInSuperoneToolDeps) {
  try {
    const path = args.path?.trim() ?? ''
    if (!isAbsolute(path)) return toolError(new Error('path must be an absolute path to an audio file'))
    let size = 0
    try {
      const info = statSync(path)
      if (!info.isFile()) return toolError(new Error('path is not a file'))
      size = info.size
    } catch {
      return toolError(new Error(`Audio file not found: ${path}`))
    }
    if (size === 0) return toolError(new Error('Audio is empty'))
    if (size > TRANSCRIBE_BYTE_LIMIT) {
      return toolError(new Error(`Audio file is too large (${size} bytes). Keep it under 25 MB.`))
    }
    const result = await transcribeAudio({
      audio: readFileSync(path),
      credentialId: args.provider,
      modelId: args.model,
      language: args.language,
      abortSignal: deps.signal,
    })
    return toolResult({
      status: 'transcribed',
      text: result.text,
      provider: result.providerId,
      model: result.model,
      ...(result.language ? { language: result.language } : {}),
    })
  } catch (error) {
    return toolError(error)
  }
}

export function registerSpeechTools(server: McpServer, deps: BuiltInSuperoneToolDeps): void {
  server.registerTool(
    'speech_list_providers',
    {
      description: LIST_SPEECH_PROVIDERS_DESCRIPTION,
      inputSchema: {
        category: z.enum(['tts', 'asr']).optional().describe('Filter by speech category. Omit to list both synthesis and transcription providers.'),
      },
    },
    (args) => listSpeechProvidersHandler(args),
  )

  server.registerTool(
    'speech_generate',
    {
      description: GENERATE_SPEECH_DESCRIPTION,
      inputSchema: {
        text: z.string().describe('The text to speak.'),
        provider: z.string().optional().describe('Configured speech provider id from speech_list_providers. Defaults to the speech binding, then the first usable key.'),
        model: z.string().optional().describe("Model id override. Defaults to the provider's first enabled speech model."),
        voice: z.string().optional().describe(SPEECH_VOICE_FIELD_DESCRIPTION),
      },
    },
    (args) => generateSpeechToolHandler(args, deps),
  )

  server.registerTool(
    'speech_transcribe',
    {
      description: TRANSCRIBE_SPEECH_DESCRIPTION,
      inputSchema: {
        path: z.string().describe('Absolute path to an audio file.'),
        provider: z.string().optional().describe('Configured transcription provider id from speech_list_providers. Defaults to the transcription binding, then the first usable key.'),
        model: z.string().optional().describe("Model id override. Defaults to the provider's first enabled transcription model."),
        language: z.string().optional().describe('Optional ISO 639-1 language hint, such as en or zh.'),
      },
    },
    (args) => transcribeSpeechToolHandler(args, deps),
  )
}
