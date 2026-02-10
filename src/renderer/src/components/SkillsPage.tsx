import { useEffect, useCallback, useState, useRef } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, PanelLeftClose, PanelLeftOpen, Code, BookOpen, Puzzle } from 'lucide-react'
import { FileIcon as UntitledFileIcon } from '@untitledui/file-icons'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { createStreamdownCodeComponent } from '@/components/chat/CodeBlock'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settings'
import type { SkillFileEntry, SkillInfo } from '../../../shared/agent-types'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin }
const streamdownComponents = { code: createStreamdownCodeComponent(codePlugin) }

interface TokenLine {
  tokens: Array<{ content: string; color?: string; htmlStyle?: Record<string, string> }>
}

function FileContentView({ code, language }: { code: string; language: string }) {
  const [lines, setLines] = useState<TokenLine[] | null>(null)
  const [fg, setFg] = useState<string | undefined>(undefined)
  const prevKey = useRef('')

  useEffect(() => {
    const themes = codePlugin.getThemes()
    const lang = language.trim().toLowerCase() || 'md'
    const key = `${lang}:${themes.join(',')}:${code.length}`
    if (key === prevKey.current) return
    prevKey.current = key

    if (!codePlugin.supportsLanguage(lang as never)) {
      setLines(null)
      return
    }

    const apply = (res: { fg?: string; tokens: Array<Array<{ content: string; color?: string; htmlStyle?: Record<string, string> }>> }) => {
      setFg(res.fg)
      setLines(res.tokens.map((line) => ({ tokens: line.map((t) => ({ content: t.content, color: t.color, htmlStyle: t.htmlStyle })) })))
    }

    const result = codePlugin.highlight({ code, language: lang as never, themes }, (res) => apply(res))
    if (result) apply(result)
  }, [code, language])

  return (
    <pre className="whitespace-pre-wrap break-words overflow-x-hidden px-1 text-xs leading-relaxed" style={{ color: fg }}>
      <code>
        {lines
          ? lines.map((line, i) => (
              <span key={i}>
                {line.tokens.map((t, j) => (
                  <span key={j} style={t.color || t.htmlStyle ? { color: t.color, ...(t.htmlStyle ?? {}) } as React.CSSProperties : undefined}>
                    {t.content}
                  </span>
                ))}
                {i < lines.length - 1 && '\n'}
              </span>
            ))
          : code}
      </code>
    </pre>
  )
}

type FrontmatterValue = string | { [key: string]: FrontmatterValue }

function parseFrontmatter(content: string): { meta: Record<string, FrontmatterValue> | null; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: null, body: content }

  const lines = match[1].split('\n')
  const root: Record<string, FrontmatterValue> = {}
  let currentKey: string | null = null

  for (const line of lines) {
    if (!line.trim()) continue
    const indent = line.search(/\S/)
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')

    if (indent === 0) {
      currentKey = key
      root[key] = value || {}
    } else if (currentKey && indent > 0) {
      const parent = root[currentKey]
      if (typeof parent === 'object') {
        parent[key] = value
      }
    }
  }

  const meta = Object.keys(root).length > 0 ? root : null
  return { meta, body: match[2] }
}

function FrontmatterTable({ meta, nested }: { meta: Record<string, FrontmatterValue>; nested?: boolean }) {
  return (
    <table className={`w-full border-collapse border border-border text-xs ${nested ? '' : 'mb-3 rounded-md'}`}>
      <tbody>
        {Object.entries(meta).map(([key, value]) => (
          <tr key={key} className="border-b border-border last:border-b-0">
            <td className="whitespace-nowrap bg-muted/50 px-3 py-1.5 align-top font-medium text-muted-foreground">{key}</td>
            <td className="px-3 py-1.5 text-foreground">
              {typeof value === 'object' ? <FrontmatterTable meta={value} nested /> : value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MarkdownView({ content }: { content: string }) {
  const { meta, body } = parseFrontmatter(content)
  return (
    <div className="px-1">
      {meta && <FrontmatterTable meta={meta} />}
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
        <Streamdown plugins={streamdownPlugins} components={streamdownComponents}>
          {body}
        </Streamdown>
      </div>
    </div>
  )
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  css: 'css',
  html: 'html',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
}

// Map non-standard extensions to @untitledui/file-icons supported types
const EXT_ICON_MAP: Record<string, string> = {
  ts: 'code', tsx: 'code', jsx: 'code',
  py: 'code', rs: 'code', go: 'code', rb: 'code',
  sh: 'code', bash: 'code', zsh: 'code',
  md: 'document', yaml: 'document', yml: 'document', toml: 'document',
}

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG_MAP[ext] ?? 'text'
}

function getFileIconType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_ICON_MAP[ext] ?? (ext || 'empty')
}

function FileIcon({ name }: { name: string }) {
  return <UntitledFileIcon type={getFileIconType(name)} size={16} className="shrink-0" />
}

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
        {open && entry.children && (
          <div>
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

function SkillCard({ skill }: { skill: SkillInfo }) {
  const { skillDetail, skillFileContent, skillFilePath, readSkill, readSkillFile, clearSkillDetail } = useSettingsStore()
  const isExpanded = skillDetail?.name === skill.name
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mdRawView, setMdRawView] = useState(false)

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
    <div className="rounded-lg border border-border bg-card">
      <div
        role="button"
        onClick={handleToggle}
        className="flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50"
      >
        <Puzzle className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{skill.displayName}</span>
          {skill.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{skill.description}</p>
          )}
        </div>
        {isExpanded ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
      </div>

      {isExpanded && skillDetail && (
        <div className="flex border-t border-border" style={{ height: 320 }}>
          {/* Left: File tree */}
          {sidebarOpen && (
            <div className="w-[200px] shrink-0 overflow-y-auto border-r border-border p-2">
              <FileTree
                entries={skillDetail.files}
                skillName={skill.name}
                selectedPath={skillFilePath}
                onSelect={handleFileSelect}
              />
            </div>
          )}
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
        </div>
      )}
    </div>
  )
}

function SkillSection({ title, skills }: { title: string; skills: SkillInfo[] }) {
  if (skills.length === 0) return null
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="flex flex-col gap-2">
        {skills.map((skill) => (
          <SkillCard key={`${skill.scope}:${skill.name}`} skill={skill} />
        ))}
      </div>
    </div>
  )
}

export function SkillsPage() {
  const { skills, fetchSkills, installSkill } = useSettingsStore()

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  const handleInstall = async () => {
    const folderPath = await window.app.selectFolder()
    if (folderPath) {
      await installSkill(folderPath)
    }
  }

  const userSkills = skills.filter((s) => s.scope === 'user')
  const projectSkills = skills.filter((s) => s.scope === 'project')

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Skills</h2>
          <p className="text-sm text-muted-foreground">Manage Claude Code skills</p>
        </div>
        <Button size="sm" onClick={handleInstall}>
          <FolderOpen className="size-4" />
          Install Skill
        </Button>
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
