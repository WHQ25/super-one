import type { IDockviewPanelHeaderProps } from 'dockview-core'

/** The slice of a dockview panel api that the activity tab headers read, for stories. */
export function fakeTabApi(title: string, isActive: boolean): IDockviewPanelHeaderProps['api'] {
  return {
    id: `panel-${title}`,
    title,
    isActive,
    group: { id: 'storybook-group' },
    onDidActiveChange: () => ({ dispose: () => {} }),
    onDidTitleChange: () => ({ dispose: () => {} }),
  } as unknown as IDockviewPanelHeaderProps['api']
}
