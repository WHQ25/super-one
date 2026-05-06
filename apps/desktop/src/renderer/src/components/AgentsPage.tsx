import { useEffect } from 'react'
import { Bot } from 'lucide-react'
import { motion, AnimatePresence, LayoutGroup } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { MarkdownView } from './MarkdownPreview'
import type { AgentInfo } from '@superone/shared/agent-types'

type AgentWithScope = AgentInfo & { scope: 'user' | 'project' }

const layoutTransition = { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const }

function AgentCard({ agent, layoutId }: { agent: AgentWithScope; layoutId: string }) {
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
    <motion.div
      layout
      layoutId={layoutId}
      transition={{ layout: layoutTransition }}
      style={{ borderRadius: 8 }}
      className="border border-border bg-card"
    >
      <div
        role="button"
        onClick={handleToggle}
        className="flex cursor-pointer flex-col gap-1.5 p-4 text-left transition-colors hover:bg-muted/50"
      >
        <div className="flex items-center gap-2">
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{agent.name}</span>
          {agent.model && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {agent.model}
            </span>
          )}
        </div>
        {agent.description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{agent.description}</p>
        )}
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && agentContent != null && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden border-t border-border"
          >
            <div className="overflow-auto p-4" style={{ maxHeight: 400 }}>
              <MarkdownView content={agentContent} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function AgentSection({ title, agents }: { title: string; agents: AgentWithScope[] }) {
  const agentContentName = useSettingsStore((s) => s.agentContentName)
  if (agents.length === 0) return null

  const expandedIdx = agents.findIndex((a) => a.name === agentContentName)
  const cardKey = (a: AgentWithScope) => `agent-${a.scope}:${a.name}`

  const hasExpanded = expandedIdx !== -1
  const hasOrphan = hasExpanded && expandedIdx % 2 !== 0
  const before = hasExpanded
    ? agents.slice(0, hasOrphan ? expandedIdx - 1 : expandedIdx)
    : agents
  const orphan = hasOrphan ? [agents[expandedIdx - 1]] : []
  const after = hasExpanded ? [...orphan, ...agents.slice(expandedIdx + 1)] : []
  const expanded = hasExpanded ? agents[expandedIdx] : null

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      <LayoutGroup id={`agents-${title}`}>
        <div className="space-y-3">
          {before.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {before.map((a) => <AgentCard key={cardKey(a)} layoutId={cardKey(a)} agent={a} />)}
            </div>
          )}
          {expanded && (
            <AgentCard key={cardKey(expanded)} layoutId={cardKey(expanded)} agent={expanded} />
          )}
          {after.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {after.map((a) => <AgentCard key={cardKey(a)} layoutId={cardKey(a)} agent={a} />)}
            </div>
          )}
        </div>
      </LayoutGroup>
    </div>
  )
}

export function AgentsPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const { agents, fetchAgents, clearAgentDetail } = useSettingsStore()

  useEffect(() => {
    clearAgentDetail()
    fetchAgents()
  }, [currentFolder, clearAgentDetail, fetchAgents])

  const userAgents = agents.filter((a) => a.scope === 'user')
  const projectAgents = agents.filter((a) => a.scope === 'project')

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('resources.agents.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('resources.agents.subtitle')}</p>
        </div>
        <ProjectSelector mode="switch" />
      </div>

      {agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('resources.agents.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('resources.agents.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <AgentSection title={t('resources.sectionUser')} agents={userAgents} />
          <AgentSection title={t('resources.sectionProject')} agents={projectAgents} />
        </div>
      )}
    </div>
  )
}
