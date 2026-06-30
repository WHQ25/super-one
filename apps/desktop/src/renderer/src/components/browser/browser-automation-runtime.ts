import { useEffect } from 'react'
import { useBrowserStore } from '@/stores/browser'
import {
  browserExecJs,
  browserCapture,
  browserNavigate,
  readBrowserConsole,
} from './browser-host-api'

const MAX_SCREENSHOT_WIDTH = 1280

interface BaseInput {
  tab?: string
  console?: 'none' | 'error' | 'all'
  selector?: string
  readiness?: 'load' | 'none'
}

function resolveBrowserId(tab?: string): string {
  const state = useBrowserStore.getState()
  const ids = Object.keys(state.tabs)
  if (tab) {
    if (!state.tabs[tab]) throw new Error(`Browser tab not found: ${tab}`)
    return tab
  }
  if (state.fullscreenId && state.tabs[state.fullscreenId]) return state.fullscreenId
  if (ids.length === 1) return ids[0]
  if (ids.length === 0) throw new Error('No browser is open. Open a browser tab first.')
  throw new Error(`Multiple browser tabs are open; specify "tab". Open tabs: ${ids.join(', ')}`)
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

function snapshotScript(input: { filter?: string; max?: number; text?: boolean }): string {
  return `(() => {
    ${HELPERS}
    const all = Array.from(document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)})).filter((el) => __sone.visible(el));
    let list = all;
    const filter = ${JSON.stringify(input.filter ?? null)};
    if (filter) { const f = filter.toLowerCase(); list = list.filter((el) => (__sone.name(el) + ' ' + (__sone.role(el) || '')).toLowerCase().includes(f)); }
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const dist = (el) => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy; return x * x + y * y; };
    const inVp = list.filter((el) => __sone.inViewport(el)).sort((a, b) => dist(a) - dist(b));
    const outVp = list.filter((el) => !__sone.inViewport(el));
    const ordered = inVp.concat(outVp).slice(0, ${input.max ?? 40});
    const out = {
      url: location.href, title: document.title, loading: document.readyState !== 'complete',
      elements: ordered.map((el) => __sone.ref(el)), elementsTotal: all.length,
    };
    ${input.text ? `out.text = (document.body && document.body.innerText || '').slice(0, 4000);` : ''}
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

export async function runBrowserOp(op: string, rawInput: unknown): Promise<unknown> {
  const input = (rawInput ?? {}) as BaseInput
  const id = resolveBrowserId(input.tab)
  switch (op) {
    case 'snapshot': {
      const page = (await browserExecJs(id, snapshotScript(input as Parameters<typeof snapshotScript>[0]))) as Record<string, unknown>
      const mode = (input.console as 'none' | 'error' | 'all' | undefined) ?? 'error'
      if (mode !== 'none') page.console = readBrowserConsole(id, mode)
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
      const url = resolveNavigateUrl(input as Parameters<typeof resolveNavigateUrl>[0])
      browserNavigate(id, url)
      if ((input.readiness ?? 'load') !== 'none') await waitForLoadStop(id)
      const tab = useBrowserStore.getState().tabs[id]
      return { ok: true, url: tab?.url ?? url, title: tab?.title ?? '', loading: tab?.loading ?? false }
    }
    default:
      throw new Error(`Unknown browser automation op: ${op}`)
  }
}

export function useBrowserAutomationHost(): void {
  useEffect(() => {
    if (!window.browserHost) return
    return window.browserHost.onAutomationCall(async ({ callId, op, input }) => {
      try {
        const result = await runBrowserOp(op, input)
        window.browserHost!.sendAutomationResult(callId, true, result)
      } catch (err) {
        window.browserHost!.sendAutomationResult(callId, false, undefined, err instanceof Error ? err.message : String(err))
      }
    })
  }, [])
}
