import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type {
  LocalAgentDocument,
  LocalAgentRunDocument,
  LocalAgentRunEventDocument,
  LocalAgentStore,
  LocalAgentStoreAgents,
  LocalAgentStoreCheckpoints,
  LocalAgentStoreListResult,
  LocalAgentStoreRunEvents,
  LocalAgentStoreRuns,
} from '@cursor/sdk'

function workspaceHash(workspaceRef: string): string {
  return createHash('md5').update(workspaceRef).digest('hex')
}

function page<T extends { updatedAt?: number; agentId?: string; runId?: string; turnNumber?: number }>(
  items: T[],
  limit: number,
  cursor: string | undefined,
  encode: (item: T) => string,
  decode: (c: string) => unknown,
  after: (item: T, decoded: unknown) => boolean,
): LocalAgentStoreListResult<T> {
  let sorted = items
  if (cursor) {
    const decoded = decode(cursor)
    sorted = items.filter((item) => after(item, decoded))
  }
  const pageItems = sorted.slice(0, limit)
  const last = pageItems.at(-1)
  return {
    items: pageItems.map((item) => structuredClone(item)),
    ...(sorted.length > limit && last ? { nextCursor: encode(last) } : {}),
  }
}

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')
}

function fromB64(cursor: string): unknown {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
}

/**
 * Product LocalAgentStore (D5): better-sqlite3 only, one native stack with SuperOne.
 */
export class BetterSqliteLocalAgentStore implements LocalAgentStore {
  readonly agents: LocalAgentStoreAgents
  readonly runs: LocalAgentStoreRuns
  readonly checkpoints: LocalAgentStoreCheckpoints
  readonly runEvents: LocalAgentStoreRunEvents

  private readonly db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(join(dbPath, '..'), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
    this.agents = this.createAgents()
    this.runs = this.createRuns()
    this.checkpoints = this.createCheckpoints()
    this.runEvents = this.createRunEvents()
  }

  static openForWorkspace(userDataRoot: string, workspaceRef: string): BetterSqliteLocalAgentStore {
    const dir = join(userDataRoot, 'cursor-sdk', workspaceHash(workspaceRef))
    mkdirSync(dir, { recursive: true })
    return new BetterSqliteLocalAgentStore(join(dir, 'agent-store.db'))
  }

  dispose(): void {
    this.db.close()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL,
        active_run_id TEXT,
        name TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        latest_checkpoint_json TEXT,
        sdk_metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS runs (
        agent_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        request_id TEXT,
        turn_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        model_json TEXT,
        result TEXT,
        error TEXT,
        usage_ref TEXT,
        usage_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        start_checkpoint_json TEXT,
        latest_checkpoint_json TEXT,
        PRIMARY KEY (agent_id, run_id)
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        agent_id TEXT NOT NULL,
        blob_id TEXT NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (agent_id, blob_id)
      );
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        offset TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        payload_ref TEXT,
        idempotency_key TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_agents_cwd ON agents(cwd);
      CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, seq);
    `)
  }

  private rowToAgent(row: Record<string, unknown>): LocalAgentDocument {
    return {
      agentId: String(row.agent_id),
      cwd: String(row.cwd),
      status: row.status as LocalAgentDocument['status'],
      activeRunId: row.active_run_id == null ? null : String(row.active_run_id),
      name: row.name == null ? null : String(row.name),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      latestCheckpoint: row.latest_checkpoint_json
        ? JSON.parse(String(row.latest_checkpoint_json))
        : null,
      sdkMetadata: row.sdk_metadata_json ? JSON.parse(String(row.sdk_metadata_json)) : undefined,
    }
  }

  private rowToRun(row: Record<string, unknown>): LocalAgentRunDocument {
    return {
      runId: String(row.run_id),
      requestId: row.request_id == null ? null : String(row.request_id),
      agentId: String(row.agent_id),
      turnNumber: Number(row.turn_number),
      status: row.status as LocalAgentRunDocument['status'],
      model: row.model_json ? JSON.parse(String(row.model_json)) : null,
      result: row.result == null ? null : String(row.result),
      error: row.error == null ? null : String(row.error),
      usageRef: row.usage_ref == null ? null : String(row.usage_ref),
      usage: row.usage_json ? JSON.parse(String(row.usage_json)) : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      startedAt: row.started_at == null ? null : Number(row.started_at),
      endedAt: row.ended_at == null ? null : Number(row.ended_at),
      startCheckpointRef: row.start_checkpoint_json
        ? JSON.parse(String(row.start_checkpoint_json))
        : null,
      latestCheckpointRef: row.latest_checkpoint_json
        ? JSON.parse(String(row.latest_checkpoint_json))
        : null,
    }
  }

  private createAgents(): LocalAgentStoreAgents {
    const db = this.db
    const toAgent = this.rowToAgent.bind(this)
    return {
      get: async ({ agentId }) => {
        const row = db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId) as Record<string, unknown> | undefined
        return row ? toAgent(row) : null
      },
      create: async ({ agent }) => {
        db.prepare(`
          INSERT INTO agents (agent_id, cwd, status, active_run_id, name, created_at, updated_at, latest_checkpoint_json, sdk_metadata_json)
          VALUES (@agentId, @cwd, @status, @activeRunId, @name, @createdAt, @updatedAt, @latestCheckpoint, @sdkMetadata)
        `).run({
          agentId: agent.agentId,
          cwd: agent.cwd,
          status: agent.status,
          activeRunId: agent.activeRunId ?? null,
          name: agent.name ?? null,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
          latestCheckpoint: agent.latestCheckpoint ? JSON.stringify(agent.latestCheckpoint) : null,
          sdkMetadata: agent.sdkMetadata ? JSON.stringify(agent.sdkMetadata) : null,
        })
        return structuredClone(agent)
      },
      update: async ({ agent }) => {
        const result = db.prepare(`
          UPDATE agents SET cwd=@cwd, status=@status, active_run_id=@activeRunId, name=@name,
            updated_at=@updatedAt, latest_checkpoint_json=@latestCheckpoint, sdk_metadata_json=@sdkMetadata
          WHERE agent_id=@agentId
        `).run({
          agentId: agent.agentId,
          cwd: agent.cwd,
          status: agent.status,
          activeRunId: agent.activeRunId ?? null,
          name: agent.name ?? null,
          updatedAt: agent.updatedAt,
          latestCheckpoint: agent.latestCheckpoint ? JSON.stringify(agent.latestCheckpoint) : null,
          sdkMetadata: agent.sdkMetadata ? JSON.stringify(agent.sdkMetadata) : null,
        })
        if (result.changes === 0) throw new Error(`Agent ${agent.agentId} not found`)
        return structuredClone(agent)
      },
      delete: async ({ filter }) => {
        let rows = db.prepare('SELECT * FROM agents').all() as Array<Record<string, unknown>>
        if (filter.agentIds?.length) {
          const set = new Set(filter.agentIds)
          rows = rows.filter((r) => set.has(String(r.agent_id)))
        }
        if (filter.cwd !== undefined) {
          rows = rows.filter((r) => String(r.cwd) === filter.cwd)
        }
        for (const row of rows) {
          const agentId = String(row.agent_id)
          db.prepare('DELETE FROM run_events WHERE run_id IN (SELECT run_id FROM runs WHERE agent_id = ?)').run(agentId)
          db.prepare('DELETE FROM runs WHERE agent_id = ?').run(agentId)
          db.prepare('DELETE FROM checkpoints WHERE agent_id = ?').run(agentId)
          db.prepare('DELETE FROM agents WHERE agent_id = ?').run(agentId)
        }
      },
      list: async (input) => {
        const filter = input?.filter
        let rows = (db.prepare('SELECT * FROM agents').all() as Array<Record<string, unknown>>).map(toAgent)
        if (filter?.cwd !== undefined) rows = rows.filter((a) => a.cwd === filter.cwd)
        rows.sort((a, b) => b.updatedAt - a.updatedAt || b.agentId.localeCompare(a.agentId))
        const limit = filter?.limit ?? 50
        return page(
          rows,
          limit,
          filter?.cursor,
          (a) => b64({ updatedAt: a.updatedAt, agentId: a.agentId }),
          fromB64,
          (a, d) => {
            const c = d as { updatedAt: number; agentId: string }
            return a.updatedAt < c.updatedAt || (a.updatedAt === c.updatedAt && a.agentId < c.agentId)
          },
        )
      },
    }
  }

  private createRuns(): LocalAgentStoreRuns {
    const db = this.db
    const toRun = this.rowToRun.bind(this)
    const upsert = (run: LocalAgentRunDocument) => {
      db.prepare(`
        INSERT INTO runs (
          agent_id, run_id, request_id, turn_number, status, model_json, result, error,
          usage_ref, usage_json, created_at, updated_at, started_at, ended_at,
          start_checkpoint_json, latest_checkpoint_json
        ) VALUES (
          @agentId, @runId, @requestId, @turnNumber, @status, @model, @result, @error,
          @usageRef, @usage, @createdAt, @updatedAt, @startedAt, @endedAt,
          @startCheckpoint, @latestCheckpoint
        )
        ON CONFLICT(agent_id, run_id) DO UPDATE SET
          request_id=excluded.request_id, turn_number=excluded.turn_number, status=excluded.status,
          model_json=excluded.model_json, result=excluded.result, error=excluded.error,
          usage_ref=excluded.usage_ref, usage_json=excluded.usage_json, updated_at=excluded.updated_at,
          started_at=excluded.started_at, ended_at=excluded.ended_at,
          start_checkpoint_json=excluded.start_checkpoint_json,
          latest_checkpoint_json=excluded.latest_checkpoint_json
      `).run({
        agentId: run.agentId,
        runId: run.runId,
        requestId: run.requestId ?? null,
        turnNumber: run.turnNumber,
        status: run.status,
        model: run.model ? JSON.stringify(run.model) : null,
        result: run.result ?? null,
        error: run.error ?? null,
        usageRef: run.usageRef ?? null,
        usage: run.usage ? JSON.stringify(run.usage) : null,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        startedAt: run.startedAt ?? null,
        endedAt: run.endedAt ?? null,
        startCheckpoint: run.startCheckpointRef ? JSON.stringify(run.startCheckpointRef) : null,
        latestCheckpoint: run.latestCheckpointRef ? JSON.stringify(run.latestCheckpointRef) : null,
      })
    }
    return {
      get: async ({ agentId, runId }) => {
        const row = db.prepare('SELECT * FROM runs WHERE agent_id = ? AND run_id = ?').get(agentId, runId) as Record<string, unknown> | undefined
        return row ? toRun(row) : null
      },
      create: async ({ run }) => {
        const existing = db.prepare('SELECT 1 FROM runs WHERE agent_id = ? AND run_id = ?').get(run.agentId, run.runId)
        if (existing) throw new Error(`Run ${run.runId} already exists for agent ${run.agentId}`)
        upsert(run)
        return structuredClone(run)
      },
      update: async ({ run }) => {
        const existing = db.prepare('SELECT 1 FROM runs WHERE agent_id = ? AND run_id = ?').get(run.agentId, run.runId)
        if (!existing) throw new Error(`Run ${run.runId} not found for agent ${run.agentId}`)
        upsert(run)
        return structuredClone(run)
      },
      delete: async ({ filter }) => {
        let rows = (db.prepare('SELECT * FROM runs').all() as Array<Record<string, unknown>>).map(toRun)
        if (filter.agentIds?.length) {
          const set = new Set(filter.agentIds)
          rows = rows.filter((r) => set.has(r.agentId))
        }
        if (filter.runIds?.length) {
          const set = new Set(filter.runIds)
          rows = rows.filter((r) => set.has(r.runId))
        }
        for (const run of rows) {
          db.prepare('DELETE FROM run_events WHERE run_id = ?').run(run.runId)
          db.prepare('DELETE FROM runs WHERE agent_id = ? AND run_id = ?').run(run.agentId, run.runId)
        }
      },
      list: async (input) => {
        const filter = input?.filter
        let rows = (db.prepare('SELECT * FROM runs').all() as Array<Record<string, unknown>>).map(toRun)
        if (filter?.agentIds?.length) {
          const set = new Set(filter.agentIds)
          rows = rows.filter((r) => set.has(r.agentId))
        }
        if (filter?.runIds?.length) {
          const set = new Set(filter.runIds)
          rows = rows.filter((r) => set.has(r.runId))
        }
        rows.sort((a, b) => a.turnNumber - b.turnNumber || a.runId.localeCompare(b.runId))
        const limit = filter?.limit ?? 50
        return page(
          rows,
          limit,
          filter?.cursor,
          (r) => b64({ turnNumber: r.turnNumber, runId: r.runId }),
          fromB64,
          (r, d) => {
            const c = d as { turnNumber: number; runId: string }
            return r.turnNumber > c.turnNumber || (r.turnNumber === c.turnNumber && r.runId > c.runId)
          },
        )
      },
    }
  }

  private createCheckpoints(): LocalAgentStoreCheckpoints {
    const db = this.db
    return {
      get: async ({ agentId, blobId }) => {
        const row = db.prepare('SELECT data FROM checkpoints WHERE agent_id = ? AND blob_id = ?').get(agentId, blobId) as { data: Buffer } | undefined
        return row ? new Uint8Array(row.data) : null
      },
      create: async ({ agentId, blobId, data }) => {
        const existing = db.prepare('SELECT 1 FROM checkpoints WHERE agent_id = ? AND blob_id = ?').get(agentId, blobId)
        if (existing) throw new Error(`Checkpoint blob ${blobId} already exists for agent ${agentId}`)
        db.prepare('INSERT INTO checkpoints (agent_id, blob_id, data) VALUES (?, ?, ?)').run(agentId, blobId, Buffer.from(data))
      },
      update: async ({ agentId, blobId, data }) => {
        const result = db.prepare('UPDATE checkpoints SET data = ? WHERE agent_id = ? AND blob_id = ?').run(Buffer.from(data), agentId, blobId)
        if (result.changes === 0) throw new Error(`Checkpoint blob ${blobId} not found for agent ${agentId}`)
      },
      delete: async ({ filter }) => {
        if (filter.agentIds?.length && filter.blobIds?.length) {
          for (const agentId of filter.agentIds) {
            for (const blobId of filter.blobIds) {
              db.prepare('DELETE FROM checkpoints WHERE agent_id = ? AND blob_id = ?').run(agentId, blobId)
            }
          }
          return
        }
        if (filter.agentIds?.length) {
          for (const agentId of filter.agentIds) {
            db.prepare('DELETE FROM checkpoints WHERE agent_id = ?').run(agentId)
          }
          return
        }
        if (filter.blobIds?.length) {
          for (const blobId of filter.blobIds) {
            db.prepare('DELETE FROM checkpoints WHERE blob_id = ?').run(blobId)
          }
          return
        }
        db.prepare('DELETE FROM checkpoints').run()
      },
      list: async (input) => {
        const filter = input?.filter
        let rows = db.prepare('SELECT agent_id, blob_id FROM checkpoints').all() as Array<{ agent_id: string; blob_id: string }>
        if (filter?.agentIds?.length) {
          const set = new Set(filter.agentIds)
          rows = rows.filter((r) => set.has(r.agent_id))
        }
        if (filter?.blobIds?.length) {
          const set = new Set(filter.blobIds)
          rows = rows.filter((r) => set.has(r.blob_id))
        }
        const ids = rows.map((r) => r.blob_id).sort()
        const limit = filter?.limit ?? 50
        let sliced = ids
        if (filter?.cursor) sliced = ids.filter((id) => id > filter.cursor!)
        const items = sliced.slice(0, limit)
        const last = items.at(-1)
        return {
          items,
          ...(sliced.length > limit && last ? { nextCursor: last } : {}),
        }
      },
    }
  }

  private createRunEvents(): LocalAgentStoreRunEvents {
    const db = this.db
    return {
      append: async (input) => {
        const max = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM run_events WHERE run_id = ?').get(input.runId) as { m: number }
        const seq = max.m + 1
        const offset = `${input.runId}:${seq}`
        const createdAt = Date.now()
        if (input.idempotencyKey) {
          const existing = db.prepare(
            'SELECT * FROM run_events WHERE run_id = ? AND idempotency_key = ?',
          ).get(input.runId, input.idempotencyKey) as Record<string, unknown> | undefined
          if (existing) {
            return {
              runId: String(existing.run_id),
              seq: Number(existing.seq),
              offset: String(existing.offset),
              eventType: String(existing.event_type),
              payload: existing.payload_json ? JSON.parse(String(existing.payload_json)) : null,
              payloadRef: existing.payload_ref == null ? null : String(existing.payload_ref),
              idempotencyKey: existing.idempotency_key == null ? null : String(existing.idempotency_key),
              createdAt: Number(existing.created_at),
            }
          }
        }
        db.prepare(`
          INSERT INTO run_events (run_id, seq, offset, event_type, payload_json, payload_ref, idempotency_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          input.runId,
          seq,
          offset,
          input.eventType,
          input.payload === undefined ? null : JSON.stringify(input.payload),
          input.payloadRef ?? null,
          input.idempotencyKey ?? null,
          createdAt,
        )
        return {
          runId: input.runId,
          seq,
          offset,
          eventType: input.eventType,
          payload: input.payload ?? null,
          payloadRef: input.payloadRef ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          createdAt,
        }
      },
      list: async (input) => {
        const limit = input.limit ?? 100
        let rows: Array<Record<string, unknown>>
        if (input.afterOffset) {
          const afterSeq = Number(String(input.afterOffset).split(':').pop())
          rows = db.prepare(
            'SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
          ).all(input.runId, afterSeq, limit + 1) as Array<Record<string, unknown>>
        } else {
          rows = db.prepare(
            'SELECT * FROM run_events WHERE run_id = ? ORDER BY seq ASC LIMIT ?',
          ).all(input.runId, limit + 1) as Array<Record<string, unknown>>
        }
        const hasMore = rows.length > limit
        const pageRows = hasMore ? rows.slice(0, limit) : rows
        const items: LocalAgentRunEventDocument[] = pageRows.map((row) => ({
          runId: String(row.run_id),
          seq: Number(row.seq),
          offset: String(row.offset),
          eventType: String(row.event_type),
          payload: row.payload_json ? JSON.parse(String(row.payload_json)) : null,
          payloadRef: row.payload_ref == null ? null : String(row.payload_ref),
          idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
          createdAt: Number(row.created_at),
        }))
        const last = items.at(-1)
        return {
          items,
          ...(hasMore && last ? { nextOffset: last.offset } : {}),
        }
      },
      delete: async ({ filter }) => {
        if (filter.runIds?.length) {
          for (const runId of filter.runIds) {
            db.prepare('DELETE FROM run_events WHERE run_id = ?').run(runId)
          }
          return
        }
        db.prepare('DELETE FROM run_events').run()
      },
    }
  }
}

const storeCache = new Map<string, BetterSqliteLocalAgentStore>()

export function getCursorAgentStore(userDataRoot: string, workspaceRef: string): BetterSqliteLocalAgentStore {
  const key = `${userDataRoot}::${workspaceRef}`
  let store = storeCache.get(key)
  if (!store) {
    store = BetterSqliteLocalAgentStore.openForWorkspace(userDataRoot, workspaceRef)
    storeCache.set(key, store)
  }
  return store
}
