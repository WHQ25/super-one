import runtimeRaw from './browser-annotate-runtime.js?raw'

export const ANNOTATE_MSG_PREFIX = '__SUPERONE_ANNO__'

export interface AnnotateRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AnnotateStyleChange {
  property: string
  previousValue: string
  value: string
}

export interface AnnotateMessage {
  op: 'commit' | 'update' | 'delete'
  id: string
  kind: 'element' | 'region'
  rect: AnnotateRect
  selector: string | null
  comment: string
  wantScreenshot: boolean
  styleChanges: AnnotateStyleChange[]
  pageUrl: string
  pageTitle: string
}

export interface AnnotateConfig {
  primary: string
  fill: string
  bg: string
  fg: string
  border: string
  mutedFg: string
  placeholder: string
  confirm: string
  cancel: string
  screenshot: string
  sColor: string
  sBg: string
  sSize: string
  sWeight: string
  sRadius: string
  sPadding: string
}

export function buildAnnotateScript(config: AnnotateConfig): string {
  return ';' + runtimeRaw + '(' + JSON.stringify(config) + ')'
}

export const ANNOTATE_CANCEL_SCRIPT =
  'window.__superoneAnnotateCancel && window.__superoneAnnotateCancel()'

export const ANNOTATE_HIDE_AND_WAIT_SCRIPT =
  'window.__superoneAnnotateHide && window.__superoneAnnotateHide();' +
  'new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(function(){r(1)})})})'

export const ANNOTATE_SHOW_SCRIPT =
  'window.__superoneAnnotateShow && window.__superoneAnnotateShow()'
