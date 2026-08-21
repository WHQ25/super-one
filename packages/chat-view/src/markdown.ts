/** Tiny fail-closed markdown subset for the WebView host. Not a full CommonMark port. */

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] ?? c))
}

export function renderMarkdownLite(src: string): string {
  let s = escapeHtml(src)
  s = s.replace(/```([\s\S]*?)```/g, '<pre class="code">$1</pre>')
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
  return s.replace(/\n/g, '<br/>')
}

export type TodoRow = { id?: string; content?: string; text?: string; status?: string }

export function renderTodos(todos: Record<string, TodoRow> | TodoRow[] | undefined): string {
  const rows = Array.isArray(todos) ? todos : Object.values(todos ?? {})
  if (!rows.length) return ''
  const items = rows.map((t) => {
    const label = escapeHtml(String(t.content ?? t.text ?? t.id ?? ''))
    const st = escapeHtml(String(t.status ?? ''))
    const mark = st === 'completed' ? '✓' : st === 'in_progress' ? '▶' : '○'
    return `<li>${mark} ${label}</li>`
  }).join('')
  return `<ul class="todos">${items}</ul>`
}
