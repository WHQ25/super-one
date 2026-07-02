import { getDb } from './database'
import type { BrowserHistoryEntry } from '@superone/shared/agent-types'

function isRecordableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

export function recordBrowserHistory(url: string, title: string, titleOnly = false): void {
  if (!isRecordableUrl(url)) return
  const db = getDb()
  if (titleOnly) {
    if (!title) return
    db.prepare('UPDATE browser_history SET title = ? WHERE url = ?').run(title, url)
    return
  }
  db.prepare(`
    INSERT INTO browser_history (url, title, visit_count, last_visit)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(url) DO UPDATE SET
      visit_count = visit_count + 1,
      last_visit = excluded.last_visit,
      title = CASE WHEN excluded.title != '' THEN excluded.title ELSE browser_history.title END
  `).run(url, title ?? '', Date.now())
}

export function suggestBrowserHistory(query: string, limit = 8): BrowserHistoryEntry[] {
  const db = getDb()
  const q = query.trim()
  if (!q) {
    const rows = db.prepare(`
      SELECT url, title, visit_count, last_visit FROM browser_history
      ORDER BY visit_count DESC, last_visit DESC LIMIT ?
    `).all(limit) as Array<{ url: string; title: string; visit_count: number; last_visit: number }>
    return rows.map(mapRow)
  }
  const like = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`
  const rows = db.prepare(`
    SELECT url, title, visit_count, last_visit FROM browser_history
    WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
    ORDER BY visit_count DESC, last_visit DESC LIMIT ?
  `).all(like, like, limit) as Array<{ url: string; title: string; visit_count: number; last_visit: number }>
  return rows.map(mapRow)
}

export function deleteBrowserHistory(url: string | null): void {
  const db = getDb()
  if (url === null) db.prepare('DELETE FROM browser_history').run()
  else db.prepare('DELETE FROM browser_history WHERE url = ?').run(url)
}

function mapRow(r: { url: string; title: string; visit_count: number; last_visit: number }): BrowserHistoryEntry {
  return { url: r.url, title: r.title, visitCount: r.visit_count, lastVisit: r.last_visit }
}
