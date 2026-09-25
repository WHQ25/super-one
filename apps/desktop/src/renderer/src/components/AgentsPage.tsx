import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import {
  ResourceScopeToolbar,
  type ResourceScopeView,
} from '@/components/settings/ResourceScopeToolbar'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { SettingsDisclosureRow } from '@/components/settings/SettingsDisclosureRow'
import { SettingsEmptyState } from '@/components/settings/SettingsEmptyState'
import { MarkdownView } from './MarkdownPreview'
import type { AgentInfo } from '@superone/shared/agent-types'

type AgentWithScope = AgentInfo & { scope: 'user' | 'project' }

function AgentRow({ agent }: { agent: AgentWithScope }) {
  const { agentContent, agentContentName, readAgentFile, clearAgentDetail } = useSettingsStore()
  const isExpanded = agentContentName === agent.name

  const handleToggle = () => {
    if (isExpanded) {
      clearAgentDetail()
    } else {
      readAgentFile(agent.name)
    }
  }

  return (
    <SettingsDisclosureRow
      expanded={isExpanded && agentContent != null}
      onToggle={handleToggle}
      icon={<Bot className="size-4" />}
      title={
        <>
          <span className="truncate">{agent.name}</span>
          {agent.model && (
            <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {agent.model}
            </span>
          )}
        </>
      }
      description={agent.description}
    >
      {agentContent != null && (
        <div className="max-h-[400px] overflow-auto rounded-md bg-background p-3">
          <MarkdownView content={agentContent} />
        </div>
      )}
    </SettingsDisclosureRow>
  )
}

export function AgentsPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const { agents, fetchAgents, clearAgentDetail } = useSettingsStore()
  const [scope, setScope] = useState<ResourceScopeView>('user')

  useEffect(() => {
    clearAgentDetail()
    fetchAgents()
  }, [currentFolder, clearAgentDetail, fetchAgents])

  const userAgents = agents.filter((a) => a.scope === 'user')
  const projectAgents = agents.filter((a) => a.scope === 'project')
  const scopedAgents = scope === 'user' ? userAgents : projectAgents

  return (
    <SettingsSection
      title={t('resources.agents.title')}
      actions={<ResourceScopeToolbar className="mb-0" scope={scope} onScopeChange={setScope} />}
    >
      {scopedAgents.length === 0 ? (
        <SettingsEmptyState title={t('resources.agents.empty')} hint={t('resources.agents.emptyHint')} />
      ) : (
        scopedAgents.map((a) => <AgentRow key={`agent-${a.scope}:${a.name}`} agent={a} />)
      )}
    </SettingsSection>
  )
}
