/**
 * The `widget_show` prompt text, in one place. The desktop registers the tool
 * in-process, lists it for Host Actions, and ships a hand-maintained copy to
 * remote nodes; a description edited in one of those left the others on the
 * older contract with nothing failing. All three import this string.
 */
export const WIDGET_SHOW_DESCRIPTION =
  'Render SVG, diagrams, charts, interactive HTML, or a SuperOne native surface (media gallery, files previewer) inline in chat. '
  + 'Pass widget_code for new content, or template + data to reuse a saved template. '
  + 'To show media you produced yourself, pass a @native/* template so it renders in SuperOne\'s own gallery '
  + '(viewer, download, drag-out) instead of a lookalike you build in widget_code — call widget_list_templates for the list. '
  + 'To hand the user several files to look at one after another (screenshots, reports, changed sources), '
  + 'pass @native/files-previewer with data.files. '
  + 'Before the first new widget in a session, load the relevant design modules with read_manual({ domain: "widget", modules: [...] }).'
