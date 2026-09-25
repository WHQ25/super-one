import { useEffect, useCallback, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, PanelLeftClose, PanelLeftOpen, Code, BookOpen, Puzzle, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import { Badge } from '@superone/ui/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import {
  ResourceScopeToolbar,
  type ResourceScopeView,
} from '@/components/settings/ResourceScopeToolbar'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { SettingsDisclosureRow } from '@/components/settings/SettingsDisclosureRow'
import { SettingsEmptyState } from '@/components/settings/SettingsEmptyState'
import { FileContentView, MarkdownView, inferLanguage } from './MarkdownPreview'
import type { SkillFileEntry, SkillInfo } from '@superone/shared/agent-types'

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

function SkillRow({ skill, readOnly }: { skill: SkillInfo; readOnly?: boolean }) {
  const { t } = useTranslation()
  const { skillDetail, skillFileContent, skillFilePath, readSkill, readSkillFile, readCodexSkill, readCodexSkillFile, clearSkillDetail, deleteSkill, disabledSkills, toggleSkill, fetchCodexSkills } = useSettingsStore()
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
  const isHidden = isCodex ? skill.enabled === false : disabledSkills.includes(skill.name)
  const canToggle = isCodex ? !skill.builtin : true

  const doReadSkill = settingsProvider === 'codex' ? readCodexSkill : readSkill
  const doReadSkillFile = settingsProvider === 'codex' ? readCodexSkillFile : readSkillFile

  useEffect(() => {
    if (isExpanded) {
      const timer = setTimeout(() => setContentReady(true), 200)
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

  const sourceDir = sourceDirOf(skill.sourcePath)

  return (
    <>
    <SettingsDisclosureRow
      expanded={isExpanded}
      onToggle={handleToggle}
      dimmed={isHidden}
      icon={<Puzzle className="size-4" />}
      title={
        <>
          <span className="truncate">{skill.displayName}</span>
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
        </>
      }
      description={skill.description}
      meta={sourceDir && <span title={skill.sourcePath}>{sourceDir}</span>}
      trailing={(canToggle || (isExpanded && canDelete)) && (
        <>
          {isExpanded && canDelete && (
            <button
              type="button"
              onClick={handleDeleteClick}
              disabled={deleting}
              className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              title={deleting ? t('resources.skills.deleting') : t('resources.skills.deleteTooltip')}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          {canToggle && (
            <Switch
              checked={!isHidden}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={(checked) => {
                if (isCodex) {
                  void window.app.codexToggleSkill(useAppStore.getState().currentFolder ?? '', { name: skill.name, path: skill.sourcePath }, checked).then(() => fetchCodexSkills())
                } else {
                  void toggleSkill(skill.name, !checked)
                }
              }}
              title={isHidden ? t('resources.skills.showToAgent') : t('resources.skills.hideFromAgent')}
            />
          )}
        </>
      )}
    >
      <div className="h-80 overflow-hidden rounded-md bg-background">
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
              <div className="h-full w-[200px] overflow-y-auto p-2">
                <FileTree
                  entries={skillDetail.files}
                  skillName={skill.name}
                  selectedPath={skillFilePath}
                  onSelect={handleFileSelect}
                />
              </div>
            </div>
            {/* Right: Code preview */}
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1">
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  {sidebarOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
                </button>
                {skillFilePath && (
                  <span className="flex-1 truncate text-[11px] text-muted-foreground">{skillFilePath}</span>
                )}
                {skillFilePath && isMarkdown(skillFilePath) && (
                  <button
                    onClick={() => setMdRawView(!mdRawView)}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
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
    </SettingsDisclosureRow>

      {/* Radix renders the dialog in a portal, so it adds no row to the card. */}
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
    </>
  )
}

export function SkillsPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const { skills, fetchSkills, fetchCodexSkills, installSkill, clearSkillDetail } = useSettingsStore()
  const [scope, setScope] = useState<ResourceScopeView>('user')
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
  const scopedSkills = scope === 'user' ? userSkills : projectSkills

  const pathHints = isCodex
    ? t('resources.skills.emptyHintCodex')
    : t('resources.skills.emptyHintClaude')

  // sourcePath is unique for local skills; remote maps include name. Append name as belt-and-suspenders.
  const rowKey = (s: SkillInfo) => `skill-${s.scope}:${s.sourcePath || s.name || 'unnamed'}`

  return (
    <SettingsSection
      title={t('resources.skills.title')}
      actions={
        <ResourceScopeToolbar
          className="mb-0"
          scope={scope}
          onScopeChange={setScope}
          actions={
            !isCodex ? (
              <Button size="sm" variant="outline" className="h-7" onClick={handleInstall}>
                <FolderOpen className="size-3.5" />
                {t('resources.skills.install')}
              </Button>
            ) : undefined
          }
        />
      }
    >
      {scopedSkills.length === 0 ? (
        <SettingsEmptyState
          title={t('resources.skills.empty')}
          hint={pathHints}
          action={!isCodex && (
            <Button size="sm" className="h-7" onClick={handleInstall}>
              <FolderOpen className="size-3.5" />
              {t('resources.skills.install')}
            </Button>
          )}
        />
      ) : (
        scopedSkills.map((s) => <SkillRow key={rowKey(s)} skill={s} />)
      )}
    </SettingsSection>
  )
}
