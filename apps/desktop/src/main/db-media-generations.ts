import { getDb } from './database'

/**
 * `running` exists for video: generation is an asynchronous job that outlives the tool call which
 * started it, so the row is written on submission and settled later. Image generation goes straight
 * to a terminal status.
 */
export type MediaGenerationStatus = 'running' | 'succeeded' | 'failed'

export interface MediaGenerationRow {
  id: string
  session_id: string | null
  project_id: string | null
  source: 'agent' | 'human'
  provider_id: string
  model: string
  media_type: string
  prompt: string
  params_json: string
  warnings_json: string
  result_paths_json: string | null
  status: MediaGenerationStatus
  error: string | null
  created_at: string
  /** The provider's own handle for the job, used to fetch status on demand. Null for images. */
  upstream_task_id: string | null
}

export interface MediaGenerationEntry {
  id: string
  sessionId: string | null
  source: 'agent' | 'human'
  providerId: string
  model: string
  mediaType: string
  prompt: string
  resultPaths: string[]
  status: MediaGenerationStatus
  error: string | null
  createdAt: string
  upstreamTaskId: string | null
}

export function insertMediaGeneration(row: MediaGenerationRow): void {
  getDb()
    .prepare(
      `INSERT INTO media_generations
        (id, session_id, project_id, source, provider_id, model, media_type, prompt,
         params_json, warnings_json, result_paths_json, status, error, created_at, upstream_task_id)
       VALUES
        (@id, @session_id, @project_id, @source, @provider_id, @model, @media_type, @prompt,
         @params_json, @warnings_json, @result_paths_json, @status, @error, @created_at,
         @upstream_task_id)`,
    )
    .run(row)
}

/** Settle a previously-submitted generation. Only the fields a completing job can change. */
export function updateMediaGeneration(
  id: string,
  patch: { status: MediaGenerationStatus; resultPaths?: string[]; error?: string | null; warnings?: unknown[] },
): void {
  getDb()
    .prepare(
      `UPDATE media_generations
          SET status = @status,
              result_paths_json = COALESCE(@result_paths_json, result_paths_json),
              warnings_json = COALESCE(@warnings_json, warnings_json),
              error = @error
        WHERE id = @id`,
    )
    .run({
      id,
      status: patch.status,
      result_paths_json: patch.resultPaths ? JSON.stringify(patch.resultPaths) : null,
      warnings_json: patch.warnings ? JSON.stringify(patch.warnings) : null,
      error: patch.error ?? null,
    })
}

function toEntry(row: MediaGenerationRow): MediaGenerationEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    source: row.source,
    providerId: row.provider_id,
    model: row.model,
    mediaType: row.media_type,
    prompt: row.prompt,
    resultPaths: row.result_paths_json ? (JSON.parse(row.result_paths_json) as string[]) : [],
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    upstreamTaskId: row.upstream_task_id,
  }
}

export function listMediaGenerations(opts?: { sessionId?: string; limit?: number }): MediaGenerationEntry[] {
  const db = getDb()
  const limit = opts?.limit ?? 100
  const rows = (
    opts?.sessionId
      ? db
          .prepare('SELECT * FROM media_generations WHERE session_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(opts.sessionId, limit)
      : db.prepare('SELECT * FROM media_generations ORDER BY created_at DESC LIMIT ?').all(limit)
  ) as MediaGenerationRow[]
  return rows.map(toEntry)
}

export function getMediaGeneration(id: string): MediaGenerationEntry | null {
  const row = getDb().prepare('SELECT * FROM media_generations WHERE id = ?').get(id) as
    | MediaGenerationRow
    | undefined
  return row ? toEntry(row) : null
}
