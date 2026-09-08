import type { AddProjectRow, AddProjectSectionModel } from './add-project-state'
import { directoryRows } from './add-project-state'
import { getBrowseLeafPathSegment } from '@superone/shared/path-browse'

/**
 * The two steps of adding a working directory.
 *
 * A **page**, not a composer popup, and a route rather than a width branch:
 * `add-dir` is in `DETAIL_SCREENS`, so at 768 pt and up the shell keeps the
 * session list beside it and this reads as a detail panel, while a phone gets a
 * full screen — the deal `worktree` and `branch` already have.
 *
 * Browsing is not reimplemented here. It is Add Project's local-folder browser
 * (`ui/browse-page.tsx` over `@superone/shared/path-browse`), where the field
 * *is* the path: everything before the last separator is the directory to list,
 * what follows filters it. Breadcrumbs, a second search box and `..` buttons all
 * turned out to be a worse way of saying the same thing.
 */

export type AddDirScope = 'project' | 'session'

export type AddDirStep =
  /** Both scopes as the host has them, and the choice of which to add to. */
  | { kind: 'overview' }
  /** Browsing for a folder to put in `scope`. */
  | { kind: 'browse'; scope: AddDirScope }

export const ADD_DIR_TEXT = {
  /** Where browsing starts; the host expands it. Add Project opens here too. */
  initialPath: '~/',
  directories: 'Directories',
  loading: 'Loading…',
  adding: 'Adding folder…',
  noDirectories: 'No folders here',
  placeholder: 'Type a path, or tap a folder',
  scopes: 'Add to',
  project: 'Project',
  session: 'Session',
  projectHint: 'Every session in this project starts with it',
  sessionHint: 'Only this session, and only until it ends',
} as const

const SCOPE_HINT: Record<AddDirScope, string> = {
  project: ADD_DIR_TEXT.projectHint,
  session: ADD_DIR_TEXT.sessionHint,
}

/**
 * The scope rows the overview ends with.
 *
 * They are rows in the same list the folders are, rather than a segmented
 * control: picking a scope is what *starts* the next step, so it reads as an
 * action — the way Add Project's own first step is a list of sources.
 */
export function scopeRows(): AddProjectRow[] {
  return (['project', 'session'] as AddDirScope[]).map((scope) => ({
    key: scope,
    icon: 'local',
    label: scope === 'project' ? ADD_DIR_TEXT.project : ADD_DIR_TEXT.session,
    hint: SCOPE_HINT[scope],
    wrapLabel: true,
    prominent: true,
  }))
}

/** The listing, filtered by whatever segment follows the last separator. */
export function browseSections(
  entries: ReadonlyArray<{ name: string }>,
  query: string,
): AddProjectSectionModel[] {
  return [{
    key: 'directories',
    label: ADD_DIR_TEXT.directories,
    rows: directoryRows(entries, getBrowseLeafPathSegment(query)),
  }]
}

