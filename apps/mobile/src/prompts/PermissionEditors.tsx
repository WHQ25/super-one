import { useState } from 'react'
import { Text, View } from 'react-native'
import type { ConfigConfirmField, HarnessId, RemoteSystemInfo, PermissionRequest } from '@superone/shared/agent-types'
import { CollaborationContent, Disclosure } from './PermissionContent'
import { EditableField, SelectField } from './EditableField'
import { AgentConfigFields } from './AgentConfigFields'
import { NativeMarkdown } from './NativeMarkdown'
import { patchLaunch } from './permission-edit-state'
import { PromptPill } from './PromptControls'
import { usePromptStyles } from './styles'

export function PermissionEditors({ request, loadSystemInfo, onChange, onValidity }: { request: PermissionRequest; loadSystemInfo?: (harness: HarnessId) => Promise<RemoteSystemInfo>; onChange: (request: PermissionRequest) => void; onValidity: (key: string, valid: boolean) => void }) {
  const styles = usePromptStyles()
  const [selectedLaunch, setSelectedLaunch] = useState(0)
  const video = request.videoGenConfirm
  if (video) {
    const params = video.params
    const provider = video.providers.find((item) => item.id === params.provider)
    const patch = (values: Partial<typeof params>) => onChange({ ...request, videoGenConfirm: { ...video, params: { ...params, ...values } } })
    const select = (label: string, key: 'provider' | 'model' | 'aspectRatio' | 'resolution', options: { id: string; label: string }[]) => <SelectField label={label} value={params[key]} options={options} onChange={(value) => {
      const next = key === 'provider' ? video.providers.find((item) => item.id === value) : undefined
      patch(next ? { provider: value, model: next.models[0]?.id ?? '', aspectRatio: next.aspectRatios.includes(params.aspectRatio) ? params.aspectRatio : next.aspectRatios[0] ?? params.aspectRatio, resolution: next.resolutions.includes(params.resolution) ? params.resolution : next.resolutions[0] ?? params.resolution } : { [key]: value })
    }} />
    return <View style={styles.stack}>
      <EditableField field={{ label: 'Prompt', type: 'string' }} value={params.prompt} onChange={(value) => patch({ prompt: String(value) })} />
      {select('Provider', 'provider', video.providers.map((item) => ({ id: item.id, label: item.label })))}
      {select('Model', 'model', provider?.models ?? [])}
      {select('Aspect ratio', 'aspectRatio', (provider?.aspectRatios ?? []).map((id) => ({ id, label: id })))}
      {select('Resolution', 'resolution', (provider?.resolutions ?? []).map((id) => ({ id, label: id })))}
      <EditableField field={{ label: 'Duration (seconds)', type: 'number', min: 1 }} value={params.duration} onChange={(value) => patch({ duration: Number(value) })} />
      <Disclosure title="Advanced settings">
        {(['fps', 'seed'] as const).map((key) => <EditableField key={key} field={{ label: key === 'fps' ? 'Frames per second' : 'Seed', type: 'number', clearable: true }} value={params[key]} onChange={(value) => patch({ [key]: value === null ? undefined : Number(value) })} />)}
        {(['generateAudio', 'watermark', 'cameraFixed'] as const).map((key) => <EditableField key={key} field={{ label: { generateAudio: 'Generate audio', watermark: 'Watermark', cameraFixed: 'Fixed camera' }[key], type: 'boolean' }} value={params[key]} onChange={(value) => patch({ [key]: value === true })} />)}
      </Disclosure>
      {video.referenceImages.length ? <Disclosure title="Reference images" initiallyOpen>{video.referenceImages.map((image) => <View key={image.path} style={styles.tight}><Text style={styles.body}>{image.role.replaceAll('_', ' ')}</Text><Text selectable style={styles.meta}>{image.path}</Text></View>)}</Disclosure> : null}
    </View>
  }
  const config = request.configConfirm
  if (config && config.resource?.operation !== 'delete') {
    const render = (field: ConfigConfirmField, resource: boolean) => <View key={`${resource}/${field.key}`} style={styles.card}>
      <Text style={styles.meta}>Current: {field.secret && field.currentValue ? '••••••••' : typeof field.currentValue === 'object' ? JSON.stringify(field.currentValue) : String(field.currentValue ?? 'Default')}</Text>
      <EditableField field={field} value={field.proposedValue} onValidity={(valid) => onValidity(field.key, valid)} onChange={(proposedValue) => {
        const replace = (item: ConfigConfirmField) => item.key === field.key ? { ...item, proposedValue } : item
        onChange({ ...request, configConfirm: { ...config, ...(resource && config.resource ? { resource: { ...config.resource, fields: config.resource.fields.map(replace) } } : { fields: config.fields?.map(replace) }) } })
      }} />
    </View>
    return <View style={styles.stack}>{config.fields?.map((field) => render(field, false))}{config.resource?.fields.map((field) => render(field, true))}</View>
  }
  const collab = request.sessionAgentsConfirm
  if (collab) return <View style={styles.stack}><View style={styles.wrap}>{collab.launches.map((launch, index) => <PromptPill key={launch.launchId} label={launch.peerTitle || launch.name || launch.agentId} selected={selectedLaunch === index} onPress={() => setSelectedLaunch(index)} />)}</View>{collab.launches.map((launch, index) => {
    if (index !== selectedLaunch) return null
    const profile = collab.profiles.find((item) => item.id === launch.agentId)
    return <View key={launch.launchId} style={styles.tight}>
      <CollaborationContent request={{ ...request, sessionAgentsConfirm: { ...collab, launches: [launch] } }} />
      {launch.mode !== 'link' && profile ? <AgentConfigFields harness={profile.harnessId} profile={profile} config={launch.config} onChange={(patch) => onChange({ ...request, sessionAgentsConfirm: { ...collab, launches: collab.launches.map((item, i) => i === index ? patchLaunch(item, patch) : item) } })} /> : null}
    </View>
  })}</View>
  const automation = request.automationConfirm
  if (automation && automation.operation !== 'delete') {
    const agent = automation.changes?.find((change) => change.field === 'agent')?.agentTo ?? automation.items[0]?.agent
    return <View style={styles.stack}>
      {automation.changes?.map((change, index) => <View key={index} style={styles.card}><Text style={styles.label}>{change.field}</Text><Text style={styles.meta}>{change.from ?? 'Default'} → {change.to ?? 'Default'}</Text></View>)}
      {automation.items.map((item, index) => <View key={item.id ?? index} style={styles.card}><Text style={styles.title}>{item.name}</Text><Text style={styles.meta}>{item.scheduleSummary}</Text>{item.prompt || item.promptPreview ? <Disclosure title="Task"><NativeMarkdown content={item.prompt || item.promptPreview || ''} /></Disclosure> : null}</View>)}
      {automation.items[0]?.enabled !== undefined ? <EditableField field={{ label: 'Enabled', type: 'boolean' }} value={automation.items[0].enabled} onChange={(enabled) => onChange({ ...request, automationConfirm: { ...automation, items: automation.items.map((item, index) => index === 0 ? { ...item, enabled: enabled === true } : item) } })} /> : null}
      {agent ? <AgentConfigFields loadSystemInfo={loadSystemInfo} harness={agent.type} config={agent} onChange={(patch) => {
        const nextAgent = { ...agent, ...patch }
        onChange({ ...request, automationConfirm: { ...automation, items: automation.items.map((item, index) => index === 0 ? { ...item, agent: nextAgent } : item), changes: automation.changes?.map((change) => change.field === 'agent' ? { ...change, agentTo: nextAgent } : change) } })
      }} /> : null}
    </View>
  }
  return null
}
