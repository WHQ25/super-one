import { getDb } from './database'

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
  status: 'succeeded' | 'failed'
  error: string | null
  created_at: string
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
  status: 'succeeded' | 'failed'
  error: string | null
  createdAt: string
}

export function insertMediaGeneration(row: MediaGenerationRow): void {
  getDb()
    .prepare(
      `INSERT INTO media_generations
        (id, session_id, project_id, source, provider_id, model, media_type, prompt,
         params_json, warnings_json, result_paths_json, status, error, created_at)
       VALUES
        (@id, @session_id, @project_id, @source, @provider_id, @model, @media_type, @prompt,
         @params_json, @warnings_json, @result_paths_json, @status, @error, @created_at)`,
    )
    .run(row)
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
