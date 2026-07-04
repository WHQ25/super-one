import { useEffect } from 'react'
import { useBrowserStore } from '@/stores/browser'
import {
  browserExecJs,
  browserCapture,
  browserNavigate,
  browserGoBack,
  browserGoForward,
  browserReload,
  isBrowserRegistered,
  readBrowserConsole,
  webContentsIdForBrowser,
  type ConsoleQuery,
} from './browser-host-api'
import { openBrowserTab } from '@/components/activity/activity-panel-api'

const MAX_SCREENSHOT_WIDTH = 1280

interface BaseInput {
  tab?: string
  include?: string[]
  filter?: string
  max?: number
  textMaxChars?: number
  console?: ConsoleQuery
  selector?: string
  readiness?: 'load' | 'none'
  action?: 'back' | 'forward' | 'reload'
  timeoutMs?: number
  url?: string
  expression?: string
  width?: number
  height?: number
  reset?: boolean
  from?: PointTarget
  to?: PointTarget
  steps?: number
  holdMs?: number
  humanize?: boolean
}

interface PointTarget {
  selector?: string
  text?: string
  x?: number
  y?: number
}

function ownedTabIds(sessionId: string): string[] {
  const state = useBrowserStore.getState()
  return Object.keys(state.tabs).filter((id) => state.tabs[id].owner === sessionId)
}

function resolveBrowserId(tab: string | undefined, sessionId: string): string {
  const state = useBrowserStore.getState()
  const owned = ownedTabIds(sessionId)
  if (tab) {
    if (!owned.includes(tab)) throw new Error(`Browser tab not found in this session: ${tab}`)
    return tab
  }
  if (state.fullscreenId && owned.includes(state.fullscreenId)) return state.fullscreenId
  if (owned.length === 1) return owned[0]
  if (owned.length === 0) throw new Error('No browser is open in this session. Use browser_open first.')
  throw new Error(`Multiple browser tabs are open; specify "tab". Open tabs: ${owned.join(', ')}`)
}

const HELPERS = `
const __sone = {
  selectorOf(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el, guard = 0;
    while (node && node.nodeType === 1 && node !== document.body && guard < 5) {
      guard++;
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      const cls = (node.className && typeof node.className === 'string')
        ? node.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2) : [];
      if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.length ? parts.join(' > ') : null;
  },
  visible(el) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' && r.width > 0 && r.height > 0;
  },
  implicitRole(el) {
    const t = el.tagName.toLowerCase();
    if (t === 'a' && el.hasAttribute('href')) return 'link';
    if (t === 'button') return 'button';
    if (t === 'input') {
      const ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(ty)) return 'button';
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      return 'textbox';
    }
    if (t === 'textarea') return 'textbox';
    if (t === 'select') return 'combobox';
    return null;
  },
  role(el) { return el.getAttribute('role') || __sone.implicitRole(el); },
  name(el) {
    return (el.getAttribute('aria-label') || el.getAttribute('placeholder')
      || (el.innerText || '').trim() || el.getAttribute('value') || el.getAttribute('title') || '').slice(0, 200);
  },
  enabled(el) { return !el.disabled && el.getAttribute('aria-disabled') !== 'true'; },
  inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  },
  box(el) {
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  },
  ref(el) {
    return {
      selector: __sone.selectorOf(el), role: __sone.role(el), name: __sone.name(el),
      enabled: __sone.enabled(el), inViewport: __sone.inViewport(el),
    };
  },
  withFields(el, ref, fields, maxChars) {
    if (!fields || !fields.length) return ref;
    const o = Object.assign({}, ref);
    const m = maxChars || 4000;
    if (fields.includes('text')) o.text = (el.innerText || '').slice(0, m);
    if (fields.includes('html')) o.html = (el.outerHTML || '').slice(0, m);
    if (fields.includes('attributes')) { o.attributes = {}; for (const a of el.attributes) o.attributes[a.name] = a.value; }
    if (fields.includes('value')) o.value = ('value' in el) ? (el.value == null ? null : el.value) : null;
    if (fields.includes('box')) o.box = __sone.box(el);
    return o;
  },
};
`

const INTERACTIVE_SELECTOR = 'a[href],button,input,textarea,select,[role],[tabindex],[onclick]'

function snapshotScript(input: { include: string[]; filter?: string; max?: number; textMaxChars?: number }): string {
  const wantMeta = input.include.includes('meta')
  const wantElements = input.include.includes('elements')
  const wantText = input.include.includes('text')
  return `(() => {
    ${HELPERS}
    const out = {};
    ${wantMeta ? `out.url = location.href; out.title = document.title; out.loading = document.readyState !== 'complete';` : ''}
    ${
      wantElements
        ? `const all = Array.from(document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)})).filter((el) => __sone.visible(el));
    let list = all;
    const filter = ${JSON.stringify(input.filter ?? null)};
    if (filter) { const f = filter.toLowerCase(); list = list.filter((el) => (__sone.name(el) + ' ' + (__sone.role(el) || '')).toLowerCase().includes(f)); }
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const dist = (el) => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy; return x * x + y * y; };
    const inVp = list.filter((el) => __sone.inViewport(el)).sort((a, b) => dist(a) - dist(b));
    const outVp = list.filter((el) => !__sone.inViewport(el));
    const ordered = inVp.concat(outVp).slice(0, ${input.max ?? 40});
    out.elements = ordered.map((el) => __sone.ref(el));
    out.elementsTotal = all.length;`
        : ''
    }
    ${wantText ? `out.text = (document.body && document.body.innerText || '').slice(0, ${input.textMaxChars ?? 4000});` : ''}
    return out;
  })()`
}

function queryScript(input: {
  role?: string
  text?: string
  selector?: string
  attributes?: Record<string, string>
  visible?: boolean
  max?: number
  fields?: string[]
}): string {
  return `(() => {
    ${HELPERS}
    const role = ${JSON.stringify(input.role ?? null)};
    const text = ${JSON.stringify(input.text ?? null)};
    const sel = ${JSON.stringify(input.selector ?? null)};
    const attrs = ${JSON.stringify(input.attributes ?? null)};
    const visibleOnly = ${input.visible !== false};
    const fields = ${JSON.stringify(input.fields ?? [])};
    const pool = sel ? Array.from(document.querySelectorAll(sel)) : Array.from(document.querySelectorAll('*'));
    const tl = text ? text.toLowerCase() : null;
    const matched = [];
    for (const el of pool) {
      if (visibleOnly && !__sone.visible(el)) continue;
      if (role) { const r = (__sone.role(el) || '').toLowerCase(); if (r !== role.toLowerCase() && el.tagName.toLowerCase() !== role.toLowerCase()) continue; }
      if (tl && !((__sone.name(el) + ' ' + (el.innerText || '')).toLowerCase().includes(tl))) continue;
      if (attrs) { let ok = true; for (const k in attrs) { if (el.getAttribute(k) !== String(attrs[k])) { ok = false; break; } } if (!ok) continue; }
      matched.push(el);
    }
    const out = matched.slice(0, ${input.max ?? 20}).map((el) => __sone.withFields(el, __sone.ref(el), fields, 4000));
    return { matches: out, total: matched.length };
  })()`
}

function inspectScript(input: { selector: string; fields?: string[]; maxChars?: number }): string {
  return `(() => {
    ${HELPERS}
    const el = document.querySelector(${JSON.stringify(input.selector)});
    if (!el) return { exists: false };
    const fields = ${JSON.stringify(input.fields ?? ['text', 'attributes', 'box'])};
    const maxChars = ${input.maxChars ?? 4000};
    const out = { exists: true, tag: el.tagName.toLowerCase(), role: __sone.role(el), name: __sone.name(el) };
    if (fields.includes('text')) out.text = (el.innerText || '').slice(0, maxChars);
    if (fields.includes('html')) out.html = (el.outerHTML || '').slice(0, maxChars);
    if (fields.includes('attributes')) { out.attributes = {}; for (const a of el.attributes) out.attributes[a.name] = a.value; }
    if (fields.includes('value')) out.value = ('value' in el) ? (el.value == null ? null : el.value) : null;
    if (fields.includes('box')) out.box = __sone.box(el);
    if (fields.includes('styles')) { const cs = getComputedStyle(el); out.styles = {}; for (const k of ['display', 'position', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'visibility', 'opacity']) out.styles[k] = cs[k]; }
    if (fields.includes('context')) {
      const ancestors = []; let p = el.parentElement, g = 0;
      while (p && p !== document.body && g < 6) { g++; ancestors.push({ tag: p.tagName.toLowerCase(), role: __sone.role(p), selector: __sone.selectorOf(p) }); p = p.parentElement; }
      const labels = [];
      if (el.id) document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]').forEach((l) => labels.push((l.innerText || '').trim()));
      const wrap = el.closest('label'); if (wrap) labels.push((wrap.innerText || '').trim());
      const formEl = el.closest('form');
      let form = null;
      if (formEl) {
        const ff = Array.from(formEl.querySelectorAll('input,textarea,select,button')).filter((e) => __sone.visible(e)).slice(0, 40).map((e) => __sone.ref(e));
        form = { selector: __sone.selectorOf(formEl), fields: ff };
      }
      out.context = { ancestors, labels, form };
    }
    return out;
  })()`
}

function clickScript(input: { selector?: string; text?: string; x?: number; y?: number }): string {
  return `(() => {
    ${HELPERS}
    const sel = ${JSON.stringify(input.selector ?? null)};
    const text = ${JSON.stringify(input.text ?? null)};
    const hasXY = ${input.x != null && input.y != null};
    const px = ${JSON.stringify(input.x ?? null)}, py = ${JSON.stringify(input.y ?? null)};
    let el = null;
    if (sel) el = document.querySelector(sel);
    else if (text) { const t = text.toLowerCase(); el = Array.from(document.querySelectorAll('a,button,input,[role],[onclick],label,summary')).filter((e) => __sone.visible(e)).find((e) => (__sone.name(e) || e.innerText || '').toLowerCase().includes(t)) || null; }
    else if (hasXY) el = document.elementFromPoint(px, py);
    if (!el) return { ok: false, error: 'click target not found' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const cx = hasXY ? px : r.left + r.width / 2, cy = hasXY ? py : r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    if (typeof el.focus === 'function') el.focus();
    return { ok: true, selector: __sone.selectorOf(el), name: __sone.name(el) };
  })()`
}

function resolvePointScript(input: { selector?: string; text?: string; x?: number; y?: number }): string {
  return `(() => {
    ${HELPERS}
    const sel = ${JSON.stringify(input.selector ?? null)};
    const text = ${JSON.stringify(input.text ?? null)};
    const hasXY = ${input.x != null && input.y != null};
    const px = ${JSON.stringify(input.x ?? null)}, py = ${JSON.stringify(input.y ?? null)};
    if (hasXY) return { ok: true, x: px, y: py };
    let el = null;
    if (sel) el = document.querySelector(sel);
    else if (text) { const t = text.toLowerCase(); el = Array.from(document.querySelectorAll('a,button,input,[role],[onclick],label,summary')).filter((e) => __sone.visible(e)).find((e) => (__sone.name(e) || e.innerText || '').toLowerCase().includes(t)) || null; }
    if (!el) return { ok: false, error: 'click target not found' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return { ok: false, error: 'click target is not visible' };
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, selector: __sone.selectorOf(el), name: __sone.name(el) };
  })()`
}

function dragDispatchScript(fromX: number, fromY: number, toX: number, toY: number, opts: { steps: number; holdMs: number; humanize: boolean }): string {
  return `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const STEP_MS = 16;
    const fx = ${fromX}, fy = ${fromY}, tx = ${toX}, ty = ${toY};
    const n = Math.max(1, Math.min(${opts.steps}, 50));
    const hold = Math.max(0, Math.min(${opts.holdMs}, 10000));
    const humanize = ${opts.humanize};
    const ease = (t) => humanize ? (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) : t;
    const stepDelay = () => humanize ? STEP_MS * (0.5 + Math.random()) : STEP_MS;
    const pointAt = (i) => { const p = i / n, t = ease(p), amp = humanize ? 6 * (1 - p) : 0; return { x: fx + (tx - fx) * t + (Math.random() * 2 - 1) * amp, y: fy + (ty - fy) * t + (Math.random() * 2 - 1) * amp }; };
    const at = (x, y) => document.elementFromPoint(x, y);
    const src = at(fx, fy) || document.body;
    const dragEl = (src.closest && src.closest('[draggable="true"]')) || (src.draggable ? src : null);
    if (dragEl) {
      const dt = new DataTransfer();
      const de = (el, type, x, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, dataTransfer: dt }));
      de(dragEl, 'dragstart', fx, fy); await sleep(STEP_MS);
      for (let i = 1; i <= n; i++) { const q = pointAt(i); const el = at(q.x, q.y) || document.body; de(el, i === 1 ? 'dragenter' : 'dragover', q.x, q.y); await sleep(stepDelay()); }
      const tgt = at(tx, ty) || document.body;
      de(tgt, 'dragenter', tx, ty); de(tgt, 'dragover', tx, ty);
      if (hold) await sleep(hold);
      de(tgt, 'drop', tx, ty); await sleep(0);
      de(dragEl, 'dragend', tx, ty);
      return { ok: true, mode: 'html5' };
    }
    const fire = (el, type, x, y, buttons) => {
      const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, isPrimary: true }));
    };
    fire(src, 'pointerdown', fx, fy, 1);
    fire(src, 'mousedown', fx, fy, 1);
    await sleep(STEP_MS);
    for (let i = 1; i <= n; i++) {
      const q = pointAt(i);
      const el = at(q.x, q.y) || src;
      fire(el, 'pointermove', q.x, q.y, 1);
      fire(el, 'mousemove', q.x, q.y, 1);
      await sleep(stepDelay());
    }
    const dst = at(tx, ty) || src;
    if (hold) await sleep(hold);
    fire(dst, 'pointerup', tx, ty, 0);
    fire(dst, 'mouseup', tx, ty, 0);
    return { ok: true, mode: 'pointer' };
  })()`
}

function typeScript(input: { text: string; selector?: string; clear?: boolean }): string {
  return `(() => {
    ${HELPERS}
    const sel = ${JSON.stringify(input.selector ?? null)};
    const text = ${JSON.stringify(input.text)};
    const clear = ${input.clear === true};
    const el = sel ? document.querySelector(sel) : document.activeElement;
    if (!el) return { ok: false, error: 'no input target' };
    if (typeof el.focus === 'function') el.focus();
    if ('value' in el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      const next = (clear ? '' : el.value) + text;
      setter.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable) {
      if (clear) el.textContent = '';
      el.textContent = (el.textContent || '') + text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } else {
      return { ok: false, error: 'target is not editable' };
    }
    return { ok: true, selector: __sone.selectorOf(el) };
  })()`
}

function waitCheckScript(input: { selector?: string; selectorGone?: string; text?: string; urlIncludes?: string }): string {
  return `(() => {
    ${HELPERS}
    const sel = ${JSON.stringify(input.selector ?? null)};
    const gone = ${JSON.stringify(input.selectorGone ?? null)};
    const text = ${JSON.stringify(input.text ?? null)};
    const url = ${JSON.stringify(input.urlIncludes ?? null)};
    const selOk = sel ? (() => { const e = document.querySelector(sel); return !!(e && __sone.visible(e)); })() : true;
    const goneOk = gone ? (() => { const e = document.querySelector(gone); return !e || !__sone.visible(e); })() : true;
    const textOk = text ? ((document.body && document.body.innerText || '').includes(text)) : true;
    const urlOk = url ? location.href.includes(url) : true;
    return selOk && goneOk && textOk && urlOk;
  })()`
}

function pressScript(input: { key: string; modifiers?: string[]; selector?: string }): string {
  return `(() => {
    ${HELPERS}
    const sel = ${JSON.stringify(input.selector ?? null)};
    const key = ${JSON.stringify(input.key)};
    const mods = ${JSON.stringify(input.modifiers ?? [])};
    const el = sel ? document.querySelector(sel) : (document.activeElement || document.body);
    if (!el) return { ok: false, error: 'no key target' };
    const init = {
      key, bubbles: true, cancelable: true,
      altKey: mods.includes('Alt'), ctrlKey: mods.includes('Control'),
      metaKey: mods.includes('Meta'), shiftKey: mods.includes('Shift'),
    };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    if (key === 'Enter' && !mods.length && el.closest) {
      const form = el.closest('form');
      if (form && form.requestSubmit) { try { form.requestSubmit(); } catch (e) {} }
    }
    return { ok: true, key };
  })()`
}

function scrollScript(input: { deltaX?: number; deltaY?: number; selector?: string }): string {
  return `(() => {
    ${HELPERS}
    const sel = ${JSON.stringify(input.selector ?? null)};
    const dx = ${input.deltaX ?? 0}, dy = ${input.deltaY ?? 0};
    if (sel) {
      const el = document.querySelector(sel);
      if (!el) return { ok: false, error: 'scroll container not found' };
      el.scrollBy(dx, dy);
      return { ok: true, scrollLeft: Math.round(el.scrollLeft), scrollTop: Math.round(el.scrollTop) };
    }
    window.scrollBy(dx, dy);
    return { ok: true, scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) };
  })()`
}

function selectScript(input: { selector: string; value?: string; label?: string; index?: number; checked?: boolean }): string {
  return `(() => {
    ${HELPERS}
    const el = document.querySelector(${JSON.stringify(input.selector)});
    if (!el) return { ok: false, error: 'element not found' };
    const value = ${JSON.stringify(input.value ?? null)};
    const label = ${JSON.stringify(input.label ?? null)};
    const index = ${JSON.stringify(input.index ?? null)};
    const checked = ${JSON.stringify(input.checked ?? null)};
    if (el.tagName === 'SELECT') {
      let opt = null;
      if (value != null) opt = Array.from(el.options).find((o) => o.value === value);
      else if (label != null) { const l = label.toLowerCase(); opt = Array.from(el.options).find((o) => o.text.trim().toLowerCase() === l) || Array.from(el.options).find((o) => o.text.toLowerCase().includes(l)); }
      else if (index != null) opt = el.options[index];
      if (!opt) return { ok: false, error: 'option not found' };
      el.value = opt.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, selected: { value: opt.value, label: opt.text.trim() } };
    }
    const ty = (el.getAttribute('type') || '').toLowerCase();
    if (ty === 'checkbox' || ty === 'radio') {
      const want = checked == null ? true : checked;
      if (el.checked !== want) el.click();
      return { ok: true, checked: el.checked };
    }
    return { ok: false, error: 'target is not a <select>, checkbox, or radio' };
  })()`
}

function resolveNavigateUrl(input: { url?: string; port?: number; path?: string; protocol?: string }): string {
  if (input.url) {
    if (/^[a-z]+:\/\//i.test(input.url)) return input.url
    const loopback = /^(localhost|127\.|0\.0\.0\.0)/.test(input.url)
    return (loopback ? 'http://' : 'https://') + input.url
  }
  if (input.port != null) {
    const proto = input.protocol ?? 'http'
    return `${proto}://localhost:${input.port}${input.path ?? ''}`
  }
  throw new Error('Provide url or port to navigate.')
}

function waitForLoadStop(id: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const state = useBrowserStore.getState()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(timer)
      resolve()
    }
    const poll = setInterval(() => {
      if (!useBrowserStore.getState().tabs[id]?.loading) finish()
    }, 100)
    const timer = setTimeout(finish, timeoutMs)
    if (!state.tabs[id]?.loading) {
      setTimeout(() => {
        if (!useBrowserStore.getState().tabs[id]?.loading) finish()
      }, 300)
    }
  })
}

async function waitForTabRegistered(id: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (isBrowserRegistered(id)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Browser tab did not initialize in time')
}

async function waitForCondition(
  id: string,
  input: { selector?: string; selectorGone?: string; text?: string; urlIncludes?: string; timeoutMs?: number },
): Promise<unknown> {
  const timeoutMs = Math.min(input.timeoutMs ?? 15_000, 60_000)
  const start = Date.now()
  const deadline = start + timeoutMs
  const script = waitCheckScript(input)
  while (Date.now() <= deadline) {
    const matched = (await browserExecJs(id, script)) as boolean
    if (matched) return { ok: true, waitedMs: Date.now() - start }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`wait_for timed out after ${timeoutMs}ms`)
}

export async function runBrowserOp(sessionId: string, op: string, rawInput: unknown): Promise<unknown> {
  const input = (rawInput ?? {}) as BaseInput
  if (op === 'open') {
    const url = input.url ?? 'about:blank'
    const targetId = input.tab ?? `browser-${crypto.randomUUID()}`
    openBrowserTab(url, targetId, sessionId)
    await waitForTabRegistered(targetId)
    if ((input.readiness ?? 'load') !== 'none') await waitForLoadStop(targetId)
    const tab = useBrowserStore.getState().tabs[targetId]
    return { ok: true, tab: targetId, url: tab?.url ?? url, title: tab?.title ?? '' }
  }
  if (op === 'tabs') {
    const state = useBrowserStore.getState()
    const tabs = ownedTabIds(sessionId).map((id) => ({
      tab: id,
      url: state.tabs[id].url,
      title: state.tabs[id].title,
      loading: state.tabs[id].loading,
      fullscreen: state.fullscreenId === id,
    }))
    return { tabs, count: tabs.length }
  }
  const id = resolveBrowserId(input.tab, sessionId)
  switch (op) {
    case 'resolveWebContentsId': {
      const webContentsId = webContentsIdForBrowser(id)
      if (webContentsId == null) throw new Error('Browser view is not attached yet')
      return { webContentsId }
    }
    case 'resolvePoint': {
      const webContentsId = webContentsIdForBrowser(id)
      if (webContentsId == null) return { ok: false, error: 'Browser view is not attached yet' }
      const point = (await browserExecJs(id, resolvePointScript(input as Parameters<typeof resolvePointScript>[0]))) as Record<string, unknown>
      return { ...point, webContentsId }
    }
    case 'emulateViewport': {
      const emulate = input.reset || input.width == null || input.height == null ? null : { width: input.width, height: input.height }
      useBrowserStore.getState().setEmulation(id, emulate)
      return { ok: true }
    }
    case 'snapshot': {
      const include = input.include?.length ? input.include : ['meta', 'elements', 'console']
      const needsPage = include.some((s) => s === 'meta' || s === 'elements' || s === 'text')
      const page = needsPage
        ? ((await browserExecJs(id, snapshotScript({ include, filter: input.filter, max: input.max, textMaxChars: input.textMaxChars }))) as Record<string, unknown>)
        : {}
      if (include.includes('console')) page.console = readBrowserConsole(id, input.console ?? {})
      return page
    }
    case 'query':
      return browserExecJs(id, queryScript(input as Parameters<typeof queryScript>[0]))
    case 'inspect':
      return browserExecJs(id, inspectScript(input as { selector: string }))
    case 'click':
      return browserExecJs(id, clickScript(input as Parameters<typeof clickScript>[0]))
    case 'type':
      return browserExecJs(id, typeScript(input as { text: string }))
    case 'screenshot': {
      let rect: Electron.Rectangle | undefined
      if (input.selector) {
        const box = (await browserExecJs(
          id,
          `(() => { const el = document.querySelector(${JSON.stringify(input.selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; })()`,
        )) as Electron.Rectangle | null
        if (!box || box.width <= 0 || box.height <= 0) throw new Error('Screenshot selector did not resolve to a visible element')
        rect = box
      }
      const image = await browserCapture(id, rect)
      if (!image || image.isEmpty()) throw new Error('Screenshot capture failed')
      const sized = image.getSize()
      const final = sized.width > MAX_SCREENSHOT_WIDTH ? image.resize({ width: MAX_SCREENSHOT_WIDTH }) : image
      const size = final.getSize()
      const data = final.toDataURL().split(',')[1] ?? ''
      return { mimeType: 'image/png' as const, data, width: size.width, height: size.height }
    }
    case 'navigate': {
      if (input.action) {
        if (input.action === 'back') browserGoBack(id)
        else if (input.action === 'forward') browserGoForward(id)
        else browserReload(id)
      } else {
        browserNavigate(id, resolveNavigateUrl(input as Parameters<typeof resolveNavigateUrl>[0]))
      }
      if ((input.readiness ?? 'load') !== 'none') await waitForLoadStop(id)
      const tab = useBrowserStore.getState().tabs[id]
      return { ok: true, action: input.action ?? 'navigate', url: tab?.url ?? '', title: tab?.title ?? '', loading: tab?.loading ?? false }
    }
    case 'wait_for':
      return waitForCondition(id, input as Parameters<typeof waitForCondition>[1])
    case 'press':
      return browserExecJs(id, pressScript(input as Parameters<typeof pressScript>[0]))
    case 'scroll':
      return browserExecJs(id, scrollScript(input as Parameters<typeof scrollScript>[0]))
    case 'drag': {
      const from = (await browserExecJs(id, resolvePointScript(input.from ?? {}))) as Record<string, unknown>
      if (from.ok === false) throw new Error(String(from.error ?? 'drag source not found'))
      const to = (await browserExecJs(id, resolvePointScript(input.to ?? {}))) as Record<string, unknown>
      if (to.ok === false) throw new Error(String(to.error ?? 'drag target not found'))
      await browserExecJs(id, dragDispatchScript(Number(from.x), Number(from.y), Number(to.x), Number(to.y), {
        steps: input.steps ?? 10,
        holdMs: input.holdMs ?? 0,
        humanize: input.humanize === true,
      }))
      return { ok: true, from: { selector: from.selector, name: from.name }, to: { selector: to.selector, name: to.name } }
    }
    case 'select':
      return browserExecJs(id, selectScript(input as Parameters<typeof selectScript>[0]))
    case 'evaluate': {
      const expr = String(input.expression ?? '')
      const value = await browserExecJs(id, `(async () => { return (${expr}); })()`)
      const json = JSON.stringify(value ?? null)
      if (json.length > 64_000) throw new Error('Evaluate result exceeds 64KB; narrow the expression')
      return { value: value ?? null }
    }
    default:
      throw new Error(`Unknown browser automation op: ${op}`)
  }
}

export function useBrowserAutomationHost(): void {
  useEffect(() => {
    if (!window.browserHost) return
    return window.browserHost.onAutomationCall(async ({ callId, sessionId, op, input }) => {
      try {
        const result = await runBrowserOp(sessionId, op, input)
        window.browserHost!.sendAutomationResult(callId, true, result)
      } catch (err) {
        window.browserHost!.sendAutomationResult(callId, false, undefined, err instanceof Error ? err.message : String(err))
      }
    })
  }, [])
}
