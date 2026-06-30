export interface BrowserStyleChange {
  property: string
  previousValue: string
  value: string
}

export interface BrowserAnnotation {
  id: string
  kind: 'element' | 'region'
  selector: string | null
  comment: string
  pageUrl: string
  pageTitle: string
  screenshot: string | null
  styleChanges: BrowserStyleChange[]
}

export function buildBrowserAnnotationText(a: BrowserAnnotation): string {
  const lines = ['<browser_annotation>']
  const title = a.pageTitle.trim() || a.pageUrl.trim()
  if (title) lines.push(`Page: ${title}`)
  if (a.kind === 'element' && a.selector) lines.push(`Element: ${a.selector}`)
  else lines.push('Region: a marked rectangular area of the page')
  if (a.comment.trim()) lines.push(`Comment: ${a.comment.trim()}`)
  if (a.styleChanges.length > 0) {
    lines.push('Requested visual changes:')
    for (const c of a.styleChanges) {
      lines.push(`- ${c.property}: ${c.previousValue || '(unset)'} → ${c.value}`)
    }
  }
  if (a.screenshot) lines.push('The attached screenshot is the annotated area.')
  lines.push('</browser_annotation>')
  return lines.join('\n')
}
