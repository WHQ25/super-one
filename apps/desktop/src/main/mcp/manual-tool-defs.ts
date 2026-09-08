import { WIDGET_GUIDELINE_MODULES } from '../generative-ui/guideline-modules'

export const MEDIA_GUIDE_TOPICS = [
  'overview',
  'ark-image',
  'ark-video',
  'openai-image',
  'openai-video',
  'google-image',
  'google-video',
  'newapi-video',
] as const

export const MINIAPP_GUIDE_TOPICS = [
  'overview',
  'manifest',
  'permissions',
  'api-theme',
  'api-locale',
  'api-agent',
  'api-system',
  'api-ui',
  'api-host',
  'packaging',
  'icon',
  'recipes',
  'tools',
] as const

export const MANUAL_DOMAINS = ['product', 'miniapp', 'media', 'widget'] as const
export type ManualDomain = (typeof MANUAL_DOMAINS)[number]

export const PRODUCT_GUIDE_TOPICS = ['overview', 'contribute', 'debug', 'collaboration', 'sessions', 'automation', 'devices', 'browser', 'memory'] as const

export const READ_MANUAL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    domain: {
      type: 'string',
      enum: MANUAL_DOMAINS,
      description: 'Manual domain. Omit to list all domains and their topics.',
    },
    topic: {
      type: 'string',
      description: 'Topic in the selected domain. Pass the domain alone to list valid topics.',
    },
    modules: {
      type: 'array',
      minItems: 1,
      maxItems: WIDGET_GUIDELINE_MODULES.length,
      uniqueItems: true,
      items: { type: 'string', enum: WIDGET_GUIDELINE_MODULES },
      description: 'Widget only: one or more guideline modules. Mutually exclusive with topic.',
    },
  },
  additionalProperties: false,
} as const
