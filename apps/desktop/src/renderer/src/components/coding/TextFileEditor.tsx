import { useCallback, useEffect, useRef, useState } from 'react'
import { useEffectiveProjectRoot } from '@/stores/app'

const AUTOSAVE_DELAY = 1000

interface TextFileEditorProps {
  content: string
  filePath: string
  onDirtyChange: (dirty: boolean) => void
  onContentChange: (text: string) => void
  onSaved?: (text: string) => void
}

export function TextFileEditor({ content, filePath, onDirtyChange, onContentChange, onSaved }: TextFileEditorProps) {
  const fileRoot = useEffectiveProjectRoot()
  const [value, setValue] = useState(content)
  const [isDirty, setIsDirty] = useState(false)
  const contentRef = useRef(content)
  const loadedRef = useRef(content)
  const savingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filePathRef = useRef(filePath)

  useEffect(() => {
    filePathRef.current = filePath
  }, [filePath])

  const save = useCallback(async (text: string) => {
    if (!fileRoot) return
    const path = filePathRef.current
    if (text === contentRef.current) return
    savingRef.current = true
    const result = await window.app.saveFile(fileRoot, path, text)
    if (result.ok) {
      contentRef.current = text
      loadedRef.current = text
      setIsDirty(false)
      onDirtyChange(false)
      onSaved?.(text)
    }
    savingRef.current = false
  }, [fileRoot, onDirtyChange, onSaved])

  useEffect(() => {
    if (savingRef.current) return
    if (content === loadedRef.current) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    contentRef.current = content
    loadedRef.current = content
    setValue(content)
    setIsDirty(false)
    onDirtyChange(false)
  }, [content, onDirtyChange])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleChange = (next: string) => {
    setValue(next)
    const dirty = next !== contentRef.current
    setIsDirty(dirty)
    onDirtyChange(dirty)
    onContentChange(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (dirty) {
      timerRef.current = setTimeout(() => { void save(next) }, AUTOSAVE_DELAY)
    }
  }

  return (
    <textarea
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      spellCheck={false}
      className="size-full resize-none border-0 bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none"
      data-testid="text-file-editor"
      data-dirty={isDirty ? 'true' : 'false'}
    />
  )
}
