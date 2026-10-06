/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ComposerActionsButton } from './ComposerActionsButton'
import { openMediaComposer } from './open-media-composer'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./open-media-composer', () => ({ openMediaComposer: vi.fn().mockResolvedValue(null) }))
beforeEach(() => vi.clearAllMocks())

it('routes the shared menu to attachment selection and both composers', () => {
  const onAttach = vi.fn()
  const target = { projectPath: '/project', sessionId: 'session' }
  render(<ComposerActionsButton target={target} onAttach={onAttach} />)
  const open = () => fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
  open()
  fireEvent.click(screen.getByRole('menuitem', { name: 'mediaComposer.attach' }))
  expect(onAttach).toHaveBeenCalledOnce()
  for (const kind of ['image', 'video'] as const) {
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: `mediaComposer.${kind}` }))
    expect(openMediaComposer).toHaveBeenCalledWith(target, kind)
  }
})

it('keeps attachments available without a writable session', () => {
  render(<ComposerActionsButton target={null} onAttach={vi.fn()} />)
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
  expect(screen.getByRole('menuitem', { name: 'mediaComposer.attach' })).not.toHaveAttribute('aria-disabled')
  for (const kind of ['image', 'video']) expect(screen.getByRole('menuitem', { name: `mediaComposer.${kind}` })).toHaveAttribute('aria-disabled', 'true')
})
