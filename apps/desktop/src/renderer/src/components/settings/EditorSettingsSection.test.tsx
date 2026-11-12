/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { EditorSettingsSection } from './EditorSettingsSection'

describe('EditorSettingsSection', () => {
  const saveAppSettings = vi.fn(
    async (patch: { editorVimMode?: boolean; editorRelativeLineNumbers?: boolean }) => ({
      editorVimMode: patch.editorVimMode ?? false,
      editorRelativeLineNumbers: patch.editorRelativeLineNumbers ?? false,
    }),
  )

  beforeEach(() => {
    saveAppSettings.mockClear()
    useAppStore.setState({ editorVimMode: false, editorRelativeLineNumbers: false })
    const w = globalThis.window as unknown as Record<string, unknown>
    w.app = {
      saveAppSettings,
      trace: () => {},
    }
  })

  it('toggles editorVimMode and editorRelativeLineNumbers in the store and persists via saveAppSettings', async () => {
    render(<EditorSettingsSection />)

    const vimToggle = screen.getByRole('switch', { name: /vim/i })
    const relToggle = screen.getByRole('switch', { name: /relative|相对行号/i })
    expect(vimToggle).toHaveAttribute('data-state', 'unchecked')
    expect(relToggle).toHaveAttribute('data-state', 'unchecked')

    fireEvent.click(vimToggle)
    await waitFor(() => {
      expect(useAppStore.getState().editorVimMode).toBe(true)
    })
    expect(saveAppSettings).toHaveBeenCalledWith({ editorVimMode: true })
    expect(vimToggle).toHaveAttribute('data-state', 'checked')

    fireEvent.click(relToggle)
    await waitFor(() => {
      expect(useAppStore.getState().editorRelativeLineNumbers).toBe(true)
    })
    expect(saveAppSettings).toHaveBeenCalledWith({ editorRelativeLineNumbers: true })
    expect(relToggle).toHaveAttribute('data-state', 'checked')
  })
})
