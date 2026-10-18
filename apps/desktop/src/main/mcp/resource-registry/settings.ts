import { isAbsolute } from 'node:path'
import {
  effectiveEndpoints, findPlan, findPlatform, selectEndpoint,
  type ConsumerId,
} from '@superone/shared/platform-registry'
import { readAppSettings } from '../../app-settings-service'
import { readProjectPreferences, saveProjectPreferences } from '../../claude-preferences-service'
import { getJevApiKeyStatus, setJevApiKey } from '../../jev/jev-api-key'
import { deleteBinding, getBinding, listCredentials, setBinding } from '../../providers/credential-store'
import { getPlatforms } from '../../providers/registry'
import type { ConfigResourceServices } from '../config-resource-services'
import { type ResourceDef } from './types'

const CONSUMERS: ConsumerId[] = ['chat:claude', 'chat:codex', 'media:image', 'media:video']
const CONSUMER_LABELS: Partial<Record<ConsumerId, string>> = {
  'chat:claude': 'Claude Default Provider', 'chat:codex': 'Codex Default Provider',
  'media:image': 'Default Image Provider', 'media:video': 'Default Video Provider',
}
const unsupported = (): never => { throw new Error('This operation is unsupported; use update with the recordId from config_read') }

function credentialLabel(id: unknown): string {
  if (!id) return 'Automatic'
  const credential = listCredentials().find((record) => record.id === id)
  if (!credential) return String(id)
  const platform = findPlatform(getPlatforms(), credential.platformId)
  return `${platform?.name ?? credential.platformId} / ${credential.name}`
}

function compatibleCredentials(consumer: ConsumerId) {
  const platforms = getPlatforms()
  return listCredentials().filter((credential) => {
    const platform = findPlatform(platforms, credential.platformId)
    const plan = findPlan(platform, credential.planId)
    return platform && plan && selectEndpoint(plan, consumer, undefined, credential, effectiveEndpoints(platform, plan, credential), readAppSettings())
  }).map(({ id, name, platformId, planId }) => ({ id, name, platformId, planId }))
}

export function settingsResources(services?: ConfigResourceServices): ResourceDef[] {
  const bindingRecord = (consumer: ConsumerId) => ({ id: consumer, credentialId: getBinding(consumer)?.credentialId ?? null })
  const binding: ResourceDef<ReturnType<typeof bindingRecord>> = {
    resource: 'default-provider', label: 'Default Provider', projectScoped: false,
    description: 'Default chat/image/video provider bindings. Read one consumer record for compatible credential choices. Update credentialId to select a key; null or empty restores automatic selection.',
    operations: ['update', 'delete'],
    fields: [{ key: 'credentialId', label: 'Credential ID', type: 'string', note: 'A compatible credential id from this record’s availableCredentials. Empty or null clears the binding.' }],
    list: () => CONSUMERS.map(bindingRecord),
    identifyBy: (record, values) => ({
      title: CONSUMER_LABELS[record.id] ?? record.id,
      subtitle: values && 'credentialId' in values
        ? `${credentialLabel(record.credentialId)} → ${credentialLabel(values.credentialId)}`
        : credentialLabel(record.credentialId),
    }),
    toRecordSummary: (record) => ({ ...record, availableCredentials: compatibleCredentials(record.id) }),
    validate: (values, record) => {
      if (!services) throw new Error('Provider settings host is unavailable')
      if (!('credentialId' in values)) return
      const id = values.credentialId
      if (id !== null && typeof id !== 'string') throw new Error('credentialId must be a string or null')
      if (id && !compatibleCredentials(record.id).some((credential) => credential.id === id)) throw new Error(`Credential cannot serve ${record.id}`)
    },
    create: unsupported,
    update: (id, values) => {
      if (!services) throw new Error('Provider settings host is unavailable')
      const consumer = id as ConsumerId
      if (values.credentialId) setBinding({ consumer, credentialId: values.credentialId as string })
      else deleteBinding(consumer)
      services.providerBindingChanged(consumer)
      return bindingRecord(consumer)
    },
    delete: (id) => {
      if (!services) throw new Error('Provider settings host is unavailable')
      deleteBinding(id as ConsumerId)
      services.providerBindingChanged(id as ConsumerId)
      return true
    },
  }
  const project: ResourceDef<{ id: string; outputStyle: string }> = {
    resource: 'project-claude', label: 'Claude Project Preferences',
    description: 'Claude output style in the calling session’s project. Empty string restores the default. Other project settings are preserved.',
    operations: ['update'],
    fields: [{ key: 'outputStyle', label: 'Output Style', type: 'string' }],
    list: (path) => [{ id: path, ...readProjectPreferences(path) }],
    identifyBy: (record) => ({ title: 'Claude Project Preferences', subtitle: record.id }),
    toRecordSummary: (record) => ({ ...record }),
    validate: (values) => {
      if (!services) throw new Error('Project settings host is unavailable')
      if (typeof values.outputStyle !== 'string') throw new Error('outputStyle must be a string; use empty string to reset')
    },
    create: unsupported, delete: unsupported,
    update: (id, values) => {
      if (!services) throw new Error('Project settings host is unavailable')
      const saved = saveProjectPreferences(id, { outputStyle: values.outputStyle as string })
      services.projectPreferencesChanged()
      return { id, ...saved }
    },
  }
  const jevRecord = () => ({ id: 'jev', ...getJevApiKeyStatus() })
  const jev: ResourceDef<ReturnType<typeof jevRecord>> = {
    resource: 'jev', label: 'Jev API Key', projectScoped: false,
    description: 'Encrypted Jev API key. Reads return a mask only. Update apiKey; empty string clears it. Enable jevFastLoopEnabled separately in general settings.',
    operations: ['update'],
    fields: [{ key: 'apiKey', label: 'Jev API Key', type: 'string', secret: true }],
    list: () => [jevRecord()], identifyBy: () => ({ title: 'Jev API Key' }),
    toRecordSummary: (record) => ({ ...record }), readField: (record) => record.masked,
    validate: (values) => {
      if (typeof values.apiKey !== 'string' || values.apiKey.startsWith('***')) throw new Error('apiKey must be a new key or empty string to clear it')
    },
    create: unsupported, delete: unsupported,
    update: (_id, values) => ({ id: 'jev', ...setJevApiKey(values.apiKey as string) }),
  }
  const resources = [binding, project, jev] as ResourceDef[]
  if (services?.setAppIcon) {
    const iconRecord = () => ({ id: 'app-icon', filePath: readAppSettings().customAppIconPath ?? null })
    resources.push({
      resource: 'app-icon', label: 'Application Icon', projectScoped: false,
      description: 'Development builds only. Set an absolute local PNG/JPEG path; null or empty restores the built-in icon.',
      operations: ['update'], fields: [{ key: 'filePath', label: 'Image File', type: 'string' }],
      list: () => [iconRecord()], identifyBy: () => ({ title: 'Application Icon' }), toRecordSummary: (record) => ({ ...record as ReturnType<typeof iconRecord> }),
      validate: (values) => {
        if (values.filePath !== null && values.filePath !== '' && (typeof values.filePath !== 'string' || !isAbsolute(values.filePath) || !/\.(png|jpe?g)$/i.test(values.filePath))) {
          throw new Error('filePath must be an absolute PNG/JPEG path, or null to reset')
        }
      },
      create: unsupported, delete: unsupported,
      update: async (_id, values) => ({ id: 'app-icon', filePath: (await services.setAppIcon!(values.filePath ? values.filePath as string : null)).customAppIconPath }),
    })
  }
  return resources
}
