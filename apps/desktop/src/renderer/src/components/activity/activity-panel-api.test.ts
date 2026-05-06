/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openFileTab, setDockApi } from './activity-panel-api'
import { useActivityPanelStore } from '@/stores/activity-panel'

describe('openFileTab', () => {
  beforeEach(() => {
    useActivityPanelStore.setState({ showPanel: false, side: 'left', panelWidth: 560 })
  })

  it('strips the trailing line suffix before opening a file preview panel', () => {
    const addPanel = vi.fn()
    setDockApi({
      panels: [],
      activePanel: undefined,
      addPanel,
    } as never)

    openFileTab('src/app.ts:12')

    expect(useActivityPanelStore.getState().showPanel).toBe(true)
    expect(addPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'file:src/app.ts',
      title: 'app.ts',
      params: { filePath: 'src/app.ts' },
    }))
  })
})
