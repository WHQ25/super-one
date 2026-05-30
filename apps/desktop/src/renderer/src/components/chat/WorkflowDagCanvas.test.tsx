/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { WorkflowDagCanvas } from './WorkflowDagCanvas'
import type { Dag } from './workflow-dag'

const dag: Dag = {
  nodes: [{ id: 'n0', label: 'Agent A', group: 'serial', col: 0, row: 0, rows: 1 }],
  edges: [],
  cols: 1,
}

function Harness() {
  const [selected, setSelected] = useState<string | undefined>('n0')
  return (
    <WorkflowDagCanvas
      dag={dag}
      selectedNodeId={selected}
      onSelectNode={(n) => setSelected(n.id)}
      overlayHeader={<div>header</div>}
      overlayContent={<div>transcript body</div>}
      onCloseOverlay={() => setSelected(undefined)}
    />
  )
}

describe('WorkflowDagCanvas overlay focus', () => {
  it('focuses the canvas container on mount so keyboard shortcuts work without a click', () => {
    const { container } = render(
      <WorkflowDagCanvas dag={dag} onSelectNode={() => {}} />,
    )
    const canvas = container.querySelector<HTMLElement>('[tabindex="0"]')
    expect(canvas).toBeTruthy()
    expect(document.activeElement).toBe(canvas)
  })

  it('returns focus to the canvas container after closing the transcript overlay', () => {
    const { container } = render(<Harness />)
    const canvas = container.querySelector<HTMLElement>('[tabindex="0"]')
    const closeBtn = container.querySelector<HTMLElement>('.bg-popover button')
    expect(canvas).toBeTruthy()
    expect(closeBtn).toBeTruthy()

    closeBtn!.focus()
    expect(document.activeElement).toBe(closeBtn)

    fireEvent.click(closeBtn!)

    expect(container.querySelector('.bg-popover')).toBeNull()
    expect(document.activeElement).toBe(canvas)
  })
})
