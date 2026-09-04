export const TABLET_SPLIT_MIN_WIDTH = 768

const DETAIL_SCREENS = new Set(['chat', 'terminal', 'settings', 'files'])

export function shouldUseTabletMultiPane(
  width: number,
  screen: string,
  hasProject: boolean,
): boolean {
  return width >= TABLET_SPLIT_MIN_WIDTH && hasProject && DETAIL_SCREENS.has(screen)
}
