import { useEffect, useCallback, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, PanelLeftClose, PanelLeftOpen, Code, BookOpen, Puzzle } from 'lucide-react'
import { motion, LayoutGroup } from 'motion/react'
import { FileIcon } from '@/components/ui/FileIcon'
import { Button } from '@/components/ui/button'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { FileContentView, MarkdownView, inferLanguage } from './MarkdownPreview'
import type { SkillFileEntry, SkillInfo } from '../../../shared/agent-types'

const layoutTransition = { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const }

function buildPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name
}

function FileTreeNode({
  entry,
  depth,
  pathPrefix,
  skillName,
  selectedPath,
  onSelect,
}: {
  entry: SkillFileEntry
  depth: number
  pathPrefix: string
  skillName: string
  selectedPath: string | null
  onSelect: (skillName: string, relativePath: string) => void
}) {
  const [open, setOpen] = useState(true)
  const fullPath = buildPath(pathPrefix, entry.name)
  const isSelected = !entry.isDirectory && fullPath === selectedPath

  if (entry.isDirectory) {
    return (
      <div style={{ paddingLeft: depth * 12 }}>
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
          {open ? (
            <FolderOpen className="size-3.5 shrink-0 text-blue-500" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-blue-500" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
        {entry.children && (
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-in-out"
            style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              {entry.children.map((child) => (
                <FileTreeNode
                  key={child.name}
                  entry={child}
                  depth={depth + 1}
                  pathPrefix={fullPath}
                  skillName={skillName}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button
        onClick={() => onSelect(skillName, fullPath)}
        className={`flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs transition-colors ${
          isSelected
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
        }`}
        style={{ paddingLeft: `${12 + 6}px` }}
      >
        <FileIcon name={entry.name} />
        <span className="truncate">{entry.name}</span>
      </button>
    </div>
  )
}

function FileTree({
  entries,
  skillName,
  selectedPath,
  onSelect,
}: {
  entries: SkillFileEntry[]
  skillName: string
  selectedPath: string | null
  onSelect: (skillName: string, relativePath: string) => void
}) {
  return (
    <div>
      {entries.map((entry) => (
        <FileTreeNode
          key={entry.name}
          entry={entry}
          depth={0}
          pathPrefix=""
          skillName={skillName}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function isMarkdown(filePath: string): boolean {
  return /\.md$/i.test(filePath)
}

function SkillCard({ skill, layoutId }: { skill: SkillInfo; layoutId: string }) {
  const { skillDetail, skillFileContent, skillFilePath, readSkill, readSkillFile, clearSkillDetail } = useSettingsStore()
  const isExpanded = skillDetail?.name === skill.name
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mdRawView, setMdRawView] = useState(false)
  const [contentReady, setContentReady] = useState(false)

  useEffect(() => {
    if (isExpanded) {
      const timer = setTimeout(() => setContentReady(true), 350)
      return () => clearTimeout(timer)
    }
    setContentReady(false)
  }, [isExpanded])

  const handleToggle = () => {
    if (isExpanded) {
      clearSkillDetail()
    } else {
      readSkill(skill.name).then(() => {
        readSkillFile(skill.name, 'SKILL.md')
      })
    }
  }

  const handleFileSelect = useCallback(
    (skillName: string, relativePath: string) => {
      readSkillFile(skillName, relativePath)
    },
    [readSkillFile]
  )

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
          <Puzzle className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{skill.displayName}</span>
        </div>
        {skill.description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{skill.description}</p>
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-border" style={{ height: 320 }}>
          {contentReady && skillDetail ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex h-full"
            >
              {/* Left: File tree */}
              <div
                className="shrink-0 overflow-hidden border-r border-border transition-[width] duration-300 ease-in-out"
                style={{ width: sidebarOpen ? 200 : 0 }}
              >
                <div className="w-[200px] overflow-y-auto p-2 h-full">
                  <FileTree
                    entries={skillDetail.files}
                    skillName={skill.name}
                    selectedPath={skillFilePath}
                    onSelect={handleFileSelect}
                  />
                </div>
              </div>
              {/* Right: Code preview */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-1.5 shrink-0 border-b border-border px-2 py-1">
                  <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                  >
                    {sidebarOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
                  </button>
                  {skillFilePath && (
                    <span className="flex-1 text-[11px] text-muted-foreground truncate">{skillFilePath}</span>
                  )}
                  {skillFilePath && isMarkdown(skillFilePath) && (
                    <button
                      onClick={() => setMdRawView(!mdRawView)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                      title={mdRawView ? 'Preview' : 'Source'}
                    >
                      {mdRawView ? <BookOpen className="size-3.5" /> : <Code className="size-3.5" />}
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-auto p-2">
                  {skillFileContent != null && skillFilePath ? (
                    isMarkdown(skillFilePath) && !mdRawView ? (
                      <MarkdownView content={skillFileContent} />
                    ) : (
                      <FileContentView
                        code={skillFileContent}
                        language={inferLanguage(skillFilePath)}
                      />
                    )
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    Select a file to preview
                  </div>
                )}
              </div>
            </div>
          </motion.div>
          ) : null}
        </div>
      )}
    </motion.div>
  )
}

function SkillSection({ title, skills }: { title: string; skills: SkillInfo[] }) {
  const skillDetail = useSettingsStore((s) => s.skillDetail)
  if (skills.length === 0) return null

  const expandedIdx = skills.findIndex((s) => s.name === skillDetail?.name)
  const cardKey = (s: SkillInfo) => `skill-${s.scope}:${s.name}`

  const hasExpanded = expandedIdx !== -1
  const hasOrphan = hasExpanded && expandedIdx % 2 !== 0
  const before = hasExpanded
    ? skills.slice(0, hasOrphan ? expandedIdx - 1 : expandedIdx)
    : skills
  const orphan = hasOrphan ? [skills[expandedIdx - 1]] : []
  const after = hasExpanded ? [...orphan, ...skills.slice(expandedIdx + 1)] : []
  const expanded = hasExpanded ? skills[expandedIdx] : null

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      <LayoutGroup id={`skills-${title}`}>
        <div className="space-y-3">
          {before.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {before.map((s) => <SkillCard key={cardKey(s)} layoutId={cardKey(s)} skill={s} />)}
            </div>
          )}
          {expanded && (
            <SkillCard key={cardKey(expanded)} layoutId={cardKey(expanded)} skill={expanded} />
          )}
          {after.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {after.map((s) => <SkillCard key={cardKey(s)} layoutId={cardKey(s)} skill={s} />)}
            </div>
          )}
        </div>
      </LayoutGroup>
    </div>
  )
}

export function SkillsPage() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const { skills, fetchSkills, installSkill, clearSkillDetail } = useSettingsStore()

  useEffect(() => {
    clearSkillDetail()
    fetchSkills()
  }, [currentFolder, clearSkillDetail, fetchSkills])

  const handleInstall = async () => {
    const folderPath = await window.app.selectFolder()
    if (folderPath) {
      await installSkill(folderPath)
    }
  }

  const userSkills = skills.filter((s) => s.scope === 'user')
  const projectSkills = skills.filter((s) => s.scope === 'project')

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Skills</h2>
          <p className="text-sm text-muted-foreground">Manage Claude Code skills</p>
        </div>
        <div className="flex items-center gap-2">
          <ProjectSelector mode="switch" />
          <Button size="sm" onClick={handleInstall}>
            <FolderOpen className="size-4" />
            Install Skill
          </Button>
        </div>
      </div>

      {skills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">No skills found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            User: ~/.claude/skills/ | Project: .claude/skills/
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <SkillSection title="User" skills={userSkills} />
          <SkillSection title="Project" skills={projectSkills} />
        </div>
      )}
    </div>
  )
}
