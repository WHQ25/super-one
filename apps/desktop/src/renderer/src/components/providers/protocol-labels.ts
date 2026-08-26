import {
  type ProtocolFamily,
  type WireProtocol,
} from '@superone/shared/platform-registry'

/**
 * Display labels for protocol families and wire protocols.
 *
 * Kept apart from the components that render them because two surfaces need the same names: the
 * create dialog's protocol grid and the endpoint dropdown in settings.
 */
export const FAMILY_LABEL_KEY: Record<ProtocolFamily, string> = {
  anthropic: 'resources.providers.familyAnthropic',
  openai: 'resources.providers.familyOpenai',
  volcengine: 'resources.providers.familyVolcengine',
  newapi: 'resources.providers.familyNewapi',
  google: 'resources.providers.familyGoogle',
}

export const PROTOCOL_LABEL_KEY: Record<WireProtocol, string> = {
  'anthropic-messages': 'resources.providers.protocolAnthropicMessages',
  'openai-chat': 'resources.providers.protocolOpenaiChatCompletion',
  'openai-responses': 'resources.providers.protocolOpenaiResponses',
  'openai-images': 'resources.providers.protocolOpenaiImages',
  'openai-audio': 'resources.providers.protocolOpenaiAudio',
  'openai-video': 'resources.providers.protocolOpenaiVideo',
  'ark-images': 'resources.providers.protocolArkImages',
  'ark-video': 'resources.providers.protocolArkVideo',
  'newapi-video': 'resources.providers.protocolNewapiVideo',
  'google-generative': 'resources.providers.protocolGoogleGenerative',
  'google-video': 'resources.providers.protocolGoogleVideo',
}
