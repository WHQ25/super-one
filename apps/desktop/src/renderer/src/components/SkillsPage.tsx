import { useEffect, useCallback, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, PanelLeftClose, PanelLeftOpen, Code, BookOpen, Puzzle, Trash2 } from 'lucide-react'
import { motion, LayoutGroup } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import { Badge } from '@superone/ui/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { FileContentView, MarkdownView, inferLanguage } from './MarkdownPreview'
import type { SkillFileEntry, SkillInfo } from '@superone/shared/agent-types'

const layoutTransition = { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const }

function buildPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name
}

function sourceDirOf(sourcePath: string): string | null {
  const trimmed = sourcePath.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (idx <= 0) return null
  return trimmed.slice(0, idx)
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

function getSkillKind(skill: SkillInfo, readOnly?: boolean): 'builtin' | 'plugin' | 'readonly' | null {
  if (skill.builtin) return 'builtin'
  if (skill.name.includes(':')) return 'plugin'
  if (readOnly) return 'readonly'
  return null
}

function SkillCard({ skill, layoutId, readOnly }: { skill: SkillInfo; layoutId: string; readOnly?: boolean }) {
  const { t } = useTranslation()
  const { skillDetail, skillFileContent, skillFilePath, readSkill, readSkillFile, readCodexSkill, readCodexSkillFile, clearSkillDetail, deleteSkill, disabledSkills, toggleSkill } = useSettingsStore()
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const isCodex = settingsProvider === 'codex'
  const isExpanded = skillDetail?.sourcePath === skill.sourcePath
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mdRawView, setMdRawView] = useState(false)
  const [contentReady, setContentReady] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const canDelete = !readOnly && !skill.name.includes(':') && !skill.builtin
  const skillKind = getSkillKind(skill, readOnly)
  const isHidden = !isCodex && disabledSkills.includes(skill.name)
  const canToggle = !isCodex

  const doReadSkill = settingsProvider === 'codex' ? readCodexSkill : readSkill
  const doReadSkillFile = settingsProvider === 'codex' ? readCodexSkillFile : readSkillFile

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
      doReadSkill(skill.name, skill.sourcePath).then(() => {
        doReadSkillFile(skill.name, 'SKILL.md', skill.sourcePath)
      })
    }
  }

  const handleFileSelect = useCallback(
    (skillName: string, relativePath: string) => {
      doReadSkillFile(skillName, relativePath, skill.sourcePath)
    },
    [doReadSkillFile, skill.sourcePath]
  )

  const handleDeleteClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!canDelete || deleting) return
    setDeleteConfirmOpen(true)
  }

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    try {
      await deleteSkill(skill)
      setDeleteConfirmOpen(false)
      setDeleting(false)
    } catch (e) {
      setDeleting(false)
      throw e
    }
  }

  return (
    <motion.div
      layout
      layoutId={layoutId}
      transition={{ layout: layoutTransition }}
      style={{ borderRadius: 8 }}
      className={`flex flex-col border border-border bg-card transition-opacity ${isHidden ? 'opacity-50' : ''}`}
    >
      <div
        role="button"
        onClick={handleToggle}
        className={`flex cursor-pointer flex-col gap-1.5 p-4 text-left transition-colors hover:bg-muted/50 ${isExpanded ? '' : 'flex-1'}`}
      >
        <div className="flex items-center gap-2">
          <Puzzle className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{skill.displayName}</span>
          {isHidden && !isExpanded && (
            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
              {t('resources.skills.disabled')}
            </Badge>
          )}
          {isExpanded && skillKind && (
            <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
              {t(`resources.skills.${skillKind}`)}
            </Badge>
          )}
          {isExpanded && (
            <div className="ml-auto flex items-center gap-2">
              {canToggle && (
                <Switch
                  checked={!isHidden}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(checked) => { void toggleSkill(skill.name, !checked) }}
                  title={isHidden ? t('resources.skills.showToAgent') : t('resources.skills.hideFromAgent')}
                />
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  disabled={deleting}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                  title={deleting ? t('resources.skills.deleting') : t('resources.skills.deleteTooltip')}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        {skill.description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{skill.description}</p>
        )}
        {sourceDirOf(skill.sourcePath) && (
          <p className="truncate text-[10px] text-muted-foreground/70" title={skill.sourcePath}>
            {sourceDirOf(skill.sourcePath)}
          </p>
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
                      title={mdRawView ? t('resources.skills.previewToggle') : t('resources.skills.sourceToggle')}
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
                    {t('resources.skills.selectFile')}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
          ) : null}
        </div>
      )}

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('resources.skills.deleteTitle')}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{skill.displayName}</span> {t('resources.skills.deleteDescSuffix')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? t('resources.skills.deleting') : t('resources.skills.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}

function SkillSection({ title, skills, readOnly }: { title: string; skills: SkillInfo[]; readOnly?: boolean }) {
  const skillDetail = useSettingsStore((s) => s.skillDetail)
  if (skills.length === 0) return null

  const expandedIdx = skillDetail
    ? skills.findIndex(
        (s) =>
          (s.sourcePath && skillDetail.sourcePath && s.sourcePath === skillDetail.sourcePath) ||
          (s.name === skillDetail.name && s.scope === skillDetail.scope),
      )
    : -1
  // sourcePath is unique for local skills; remote maps include name. Append name as belt-and-suspenders.
  const cardKey = (s: SkillInfo) => `skill-${s.scope}:${s.sourcePath || s.name || 'unnamed'}`

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
              {before.map((s) => <SkillCard key={cardKey(s)} layoutId={cardKey(s)} skill={s} readOnly={readOnly} />)}
            </div>
          )}
          {expanded && (
            <SkillCard key={cardKey(expanded)} layoutId={cardKey(expanded)} skill={expanded} readOnly={readOnly} />
          )}
          {after.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {after.map((s) => <SkillCard key={cardKey(s)} layoutId={cardKey(s)} skill={s} readOnly={readOnly} />)}
            </div>
          )}
        </div>
      </LayoutGroup>
    </div>
  )
}

export function SkillsPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const { skills, fetchSkills, fetchCodexSkills, installSkill, clearSkillDetail } = useSettingsStore()
  const isCodex = settingsProvider === 'codex'

  useEffect(() => {
    clearSkillDetail()
    if (isCodex) {
      fetchCodexSkills()
    } else {
      fetchSkills()
    }
  }, [currentFolder, isCodex, clearSkillDetail, fetchSkills, fetchCodexSkills])

  const handleInstall = async () => {
    const folderPath = await window.app.selectFolder()
    if (folderPath) {
      await installSkill(folderPath)
    }
  }

  const userSkills = skills.filter((s) => s.scope === 'user')
  const projectSkills = skills.filter((s) => s.scope === 'project')

  const pathHints = isCodex
    ? t('resources.skills.emptyHintCodex')
    : t('resources.skills.emptyHintClaude')

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {!isCodex && (
            <Button size="sm" onClick={handleInstall}>
              <FolderOpen className="size-4" />
              {t('resources.skills.install')}
            </Button>
          )}
        </div>
        <div className="shrink-0">
          <ProjectSelector />
        </div>
      </div>

      {skills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('resources.skills.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{pathHints}</p>
        </div>
      ) : (
        <div className="space-y-6">
          <SkillSection title={t('resources.sectionUser')} skills={userSkills} />
          <SkillSection title={t('resources.sectionProject')} skills={projectSkills} />
        </div>
      )}
    </div>
  )
}
