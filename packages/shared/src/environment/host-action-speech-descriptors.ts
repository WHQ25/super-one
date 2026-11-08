import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  GENERATE_SPEECH_DESCRIPTION,
  LIST_SPEECH_PROVIDERS_DESCRIPTION,
  SPEECH_VOICE_FIELD_DESCRIPTION,
  TRANSCRIBE_SPEECH_DESCRIPTION,
} from '../superone-tool-descriptions'

export const HOST_ACTION_SPEECH_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    name: 'speech_list_providers',
    description: LIST_SPEECH_PROVIDERS_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['tts', 'asr'],
          description: 'Filter by speech category. Omit to list both synthesis and transcription providers.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'speech_generate',
    description: GENERATE_SPEECH_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to speak.' },
        provider: { type: 'string', description: 'Configured speech provider id from speech_list_providers. Defaults to the speech binding, then the first usable key.' },
        model: { type: 'string', description: "Model id override. Defaults to the provider's first enabled speech model." },
        voice: { type: 'string', description: SPEECH_VOICE_FIELD_DESCRIPTION },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'speech_transcribe',
    description: TRANSCRIBE_SPEECH_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to an audio file.' },
        provider: { type: 'string', description: 'Configured transcription provider id from speech_list_providers. Defaults to the transcription binding, then the first usable key.' },
        model: { type: 'string', description: "Model id override. Defaults to the provider's first enabled transcription model." },
        language: { type: 'string', description: 'Optional ISO 639-1 language hint, such as en or zh.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
]
