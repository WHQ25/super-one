/**
 * Browser observe/act primitives for the Jev fast loop, over CDP from main.
 *
 * Ported from jev-ultrafast's snapshot.js. What matters and is kept:
 *  - node identity lives in the page (`window.__soneJev`), so an action names an
 *    observed DOM node, never a model-generated selector;
 *  - freshness is scoped: `guard(node)` covers the target and its form/dialog/row,
 *    so unrelated page churn (chat streams, live lists) does not invalidate a click;
 *  - geometry is re-resolved and hit-tested right before input.
 */

import { cdpClick, cdpSend } from '../browser/browser-cdp'
import { browserActionsFailure, type PrimitiveRunner, runBrowserActions } from '../mcp/browser-act'

import { RunPaused, StaleObservation } from './loop'
import type { RawElement, RunObservation } from './observation'
export type { RawElement } from './observation'

export interface PageObservation extends RunObservation {
  marker: unknown
  pageKey: unknown
  guards: Record<string, unknown>
}

const MAX_ELEMENTS = 250
const MAX_TEXT = 4000

// One evaluate: reads controls + visible text and records node identity. The
// `__soneJev` cache is per document; a navigation drops it with the window.
const OBSERVE_SCRIPT = `(() => {
  if (!document.body) return null;
  const cache = window.__soneJev ||= { ids: new WeakMap(), nodes: new Map(), next: 1 };
  const identity = (e) => {
    if (!cache.ids.has(e)) cache.ids.set(e, cache.next++);
    const id = cache.ids.get(e); cache.nodes.set(id, e); return id;
  };
  for (const [id, e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id);
  const visible = (e) => !e.closest('[aria-hidden="true"],[inert]') && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const name = (e, seen = new Set()) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);
    const referenced = (e.getAttribute('aria-labelledby') || '').split(/\\s+/).map((id) => name(document.getElementById(id), seen)).filter(Boolean).join(' ');
    return referenced || e.getAttribute('aria-label')
      || [...(e.labels || [])].map((l) => name(l, seen)).filter(Boolean).join(' ')
      || (['button', 'submit', 'reset'].includes(e.type) ? e.value : '') || e.getAttribute('alt')
      || (e.tagName === 'INPUT' ? '' : [...e.childNodes].map((n) => n.nodeType === 3 ? n.textContent
        // A <noscript> holds its markup as a text node, and reading it turns a
        // lazy-loaded image's fallback into the element's name (allrecipes).
        : n.nodeType === 1 && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(n.tagName) && n.getAttribute('aria-hidden') !== 'true' ? name(n, seen) : '').join(' ').trim())
      || e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };
  const roles = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'treeitem', 'combobox', 'textbox', 'searchbox', 'spinbutton'];
  const selector = 'a[href],button,input,textarea,summary,[contenteditable="true"],[contenteditable=""],' + roles.map((r) => '[role="' + r + '"]').join(',');
  const role = (e) => {
    const explicit = e.getAttribute('role');
    if (roles.includes(explicit)) return explicit;
    if (e.tagName === 'BUTTON' || e.tagName === 'SUMMARY') return 'button';
    if (e.tagName === 'A') return 'link';
    if (e.tagName === 'TEXTAREA' || e.isContentEditable) return 'textbox';
    if (e.tagName === 'INPUT') {
      if (['checkbox', 'radio'].includes(e.type)) return e.type;
      if (['button', 'submit', 'reset', 'image'].includes(e.type)) return 'button';
      if (e.type === 'search') return 'searchbox';
      if (e.type === 'number') return 'spinbutton';
      if (['text', 'email', 'url', 'tel', 'password'].includes(e.type)) return 'textbox';
    }
    return null;
  };
  cache.pageKey = () => [performance.timeOrigin, location.href, scrollX, scrollY, innerWidth, innerHeight,
    [...document.querySelectorAll('input,textarea,select')].filter((e) => e.type !== 'password' && e.type !== 'hidden')
      .map((e) => [identity(e), e.value, e.checked, e.selectedIndex, e.disabled, e.readOnly])];
  cache.guard = (e) => {
    if (!e?.isConnected || !visible(e)) return null;
    const scope = e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') || e.parentElement;
    return [identity(e), role(e), name(e), e.type === 'password' ? null : e.value ?? null, e.checked ?? null, e.readOnly ?? null,
      e.matches(':disabled'), e.getAttribute('aria-disabled'), e.getAttribute('aria-expanded'),
      e.getAttribute('aria-checked'), e.getAttribute('aria-selected'), e.getAttribute('href'),
      (scope?.innerText || '').slice(0, 4000)];
  };
  // Can a click at this element's centre reach it? Same test the executor applies
  // before dispatching input; offering an element an open overlay covers (arXiv's
  // panel over the page's own Search button) makes Jev pick it every turn and the
  // click refuse every turn, until the budget is gone.
  const reachable = (c) => {
    if (!visible(c)) return false;
    const r = c.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (r.width <= 0 || r.height <= 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    return c.contains(document.elementFromPoint(x, y));
  };
  // Design systems hide the real input (opacity 0) behind a styled label that
  // takes the click (Coursera's filter checkboxes). The label is what can be
  // clicked; the input still says what it means.
  const clickTarget = (e) => {
    if (reachable(e)) return e;
    for (const l of e.labels || []) if (reachable(l)) return l;
    return null;
  };
  const elements = [];
  let omitted = 0;
  for (const e of document.querySelectorAll(selector)) {
    if (['file', 'hidden'].includes(e.type) || e.matches(':disabled') || e.closest('[aria-disabled="true"]')) continue;
    const rname = role(e), hit = rname ? clickTarget(e) : null;
    if (!hit) continue;
    if (elements.length >= ${MAX_ELEMENTS}) { omitted++; continue; }
    const editable = !e.readOnly && e.getAttribute('aria-readonly') !== 'true' && e.type !== 'password'
      && (['textbox', 'searchbox', 'spinbutton'].includes(rname) || (rname === 'combobox' && ['INPUT', 'TEXTAREA'].includes(e.tagName)) || e.isContentEditable);
    const value = e.type === 'password' ? '' : 'value' in e && e.tagName !== 'BUTTON' ? String(e.value ?? '') : (e.isContentEditable || rname === 'combobox' ? (e.innerText || '').trim() : '');
    const item = {
      node: identity(hit), role: rname, label: (name(e) || rname).slice(0, 120), value: value.slice(0, 200),
      bounds: (() => { const r = hit.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
      editable, password: e.type === 'password',
      submit: e.type === 'submit' || (rname === 'button' && !!e.closest('form')),
      disabled: false,
    };
    for (const key of ['checked', 'selected', 'expanded']) {
      const v = e.getAttribute('aria-' + key);
      if (v !== null) item[key] = v;
    }
    if (['checkbox', 'radio'].includes(e.type)) item.checked = String(e.checked);
    if (e.tagName === 'A') item.href = e.href;
    elements.push(item);
  }
  // A picture, canvas or map with no controls of its own: nothing the loop can
  // do to it, but where a handed-over point or path would land (§11.4). Listed
  // with its viewport box — browser_act's x/y space — and said in the text so
  // the needs_input verdict and the hand_target head can name it.
  const pictures = [];
  for (const e of document.querySelectorAll('canvas,img,svg,video,[role="img"],map area')) {
    if (pictures.length >= 12 || !reachable(e) || e.closest(selector)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 48 || r.height < 48) continue;
    const label = (name(e) || (e.tagName === 'CANVAS' ? 'Canvas' : 'Picture')).slice(0, 120);
    pictures.push({ node: identity(e), role: 'image', label, value: '', editable: false, password: false, submit: false, disabled: false,
      clickable: false, picture: true, bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } });
  }
  for (const p of pictures) if (elements.length < ${MAX_ELEMENTS}) elements.push(p);
  const words = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange(); let node, length = 0;
  while ((node = walker.nextNode()) && length < ${MAX_TEXT}) {
    const value = node.textContent.trim(), parent = node.parentElement;
    if (!value || !parent || parent.closest('script,style,noscript,template') || !visible(parent)) continue;
    range.selectNodeContents(node); const r = range.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) {
      words.push(value); length += value.length;
    }
  }
  for (const p of pictures) words.push('(picture-only: ' + p.label + ')');
  const text = words.join('\\n').slice(0, ${MAX_TEXT}), height = document.documentElement.scrollHeight;
  const pageKey = cache.pageKey(), guards = {};
  for (const el of elements) guards[el.node] = cache.guard(cache.nodes.get(el.node));
  const marker = [performance.timeOrigin, location.href, scrollX, scrollY, innerWidth, innerHeight, document.title, text, elements, pageKey[6]];
  return { url: location.href, title: document.title, text, elements, omitted,
    scroll: { y: scrollY, height, viewport: innerHeight }, loading: document.readyState !== 'complete',
    marker, pageKey, guards };
})()`

interface EvalResult<T> {
  result?: { value?: T }
  exceptionDetails?: unknown
}

async function evaluate<T>(webContentsId: number, expression: string, awaitPromise = false): Promise<T | null> {
  const res = await cdpSend<EvalResult<T>>(webContentsId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
  if (res.exceptionDetails) throw new StaleObservation('Document changed during evaluation')
  return res.result?.value ?? null
}

export async function observePage(webContentsId: number): Promise<PageObservation> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const page = await evaluate<PageObservation>(webContentsId, OBSERVE_SCRIPT)
      if (page) return page
    } catch (err) {
      if (!(err instanceof StaleObservation) || attempt === 9) throw err
    }
    await sleep(50)
  }
  throw new StaleObservation('Page did not settle')
}

/**
 * Scoped freshness. With a target node, only its guard and the form state key
 * must match; without one (scroll), the whole-page marker must.
 */
export async function isFresh(webContentsId: number, page: PageObservation, node?: number): Promise<boolean> {
  if (node != null) {
    const current = await evaluate<[unknown, unknown]>(
      webContentsId,
      `(() => { const c = window.__soneJev; return c ? [c.pageKey(), c.guard(c.nodes.get(${node}))] : null; })()`,
    )
    return JSON.stringify(current) === JSON.stringify([page.pageKey, page.guards[String(node)] ?? null])
  }
  const marker = await evaluate<unknown>(webContentsId, `(() => { const s = ${OBSERVE_SCRIPT}; return s ? s.marker : null; })()`)
  return JSON.stringify(marker) === JSON.stringify(page.marker)
}

const TARGET_POINT = (node: number, requireEditable: boolean) => `(() => {
  const e = window.__soneJev?.nodes.get(${node});
  if (!e?.isConnected || e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]')
      || !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
  if (${requireEditable} && (e.readOnly || e.getAttribute('aria-readonly') === 'true')) return null;
  e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
  if (!r.width || !r.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
  if (!e.contains(document.elementFromPoint(x, y))) return null;
  return { x, y };
})()`

async function resolveTarget(webContentsId: number, node: number, requireEditable: boolean): Promise<{ x: number; y: number }> {
  const point = await evaluate<{ x: number; y: number }>(webContentsId, TARGET_POINT(node, requireEditable))
  if (!point) throw new StaleObservation('Target changed or is covered')
  return point
}

export async function clickNode(webContentsId: number, node: number): Promise<void> {
  const { x, y } = await resolveTarget(webContentsId, node, false)
  await cdpClick(webContentsId, x, y)
}

/** Click to focus, select all, then insert — replace semantics, trusted input, works for contenteditable. */
export async function typeIntoNode(webContentsId: number, node: number, text: string): Promise<void> {
  const { x, y } = await resolveTarget(webContentsId, node, true)
  await cdpClick(webContentsId, x, y)
  const modifiers = process.platform === 'darwin' ? 4 : 2
  await cdpSend(webContentsId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers, commands: ['selectAll'] })
  await cdpSend(webContentsId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers })
  await cdpSend(webContentsId, 'Input.insertText', { text })
}

/** Focus the field with a real click, then a trusted Enter — the keyboard form submit. */
export async function pressEnterInNode(webContentsId: number, node: number): Promise<void> {
  const { x, y } = await resolveTarget(webContentsId, node, true)
  await cdpClick(webContentsId, x, y)
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await cdpSend(webContentsId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' })
  await cdpSend(webContentsId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

/**
 * Actions the caller handed over at a `capability` pause, in `browser_act`'s
 * own vocabulary, run by the tool's own mapping (§11.4). They were written
 * against the pause snapshot: a page whose marker has moved since is stale,
 * and the loop re-observes before it acts. A failed action is the tool's own
 * failure line, raised so the run pauses on it rather than reading the page
 * as if the action had happened.
 */
export async function actOnPage(
  webContentsId: number,
  page: PageObservation,
  actions: ReadonlyArray<Record<string, unknown>>,
  runPrimitive: PrimitiveRunner,
  tab: string | undefined,
): Promise<void> {
  if (!(await isFresh(webContentsId, page))) throw new StaleObservation('The page changed before the handed-over actions could run.')
  const reply = await runBrowserActions(runPrimitive, actions, { tab })
  const failure = browserActionsFailure(reply)
  if (failure) throw new RunPaused('no-progress', `Handed-over browser action failed: ${failure}`)
}

export async function scrollPage(webContentsId: number, page: PageObservation, deltaY: number): Promise<void> {
  const y = Math.floor(page.scroll.viewport * 0.8)
  await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y, deltaX: 0, deltaY })
}

/**
 * In-page wait for the page to settle into a state that differs from `page`
 * (or, after typing into an ARIA combobox, for its options to be visible).
 *
 * A difference must hold across a tick before it counts: animated heroes and
 * rotating promos flip a viewport-text marker for a frame and flip it back,
 * and returning on one of those observes the page before it has reacted at
 * all. Once it holds, the observable state itself must stop changing — a menu
 * that transitions its items into view (apple.com) reveals them without
 * mutating the DOM, so DOM quiet is not evidence that it finished.
 */
export interface SettleOutcome {
  changed: boolean
  /** Whether anything differed when it concluded, and how much was on screen. */
  fields: string[]
  elements: number
}

/**
 * Builds that wait, as an expression evaluated in the page.
 */
function changeWaitExpr(page: PageObservation, timeoutMs: number, opts: { node?: number; typed?: boolean; graceMs: number }): string {
  return `((seen, timeoutMs, graceMs) => new Promise((resolve) => {
    const field = window.__soneJev?.nodes.get(${opts.node ?? -1});
    const autocomplete = ${opts.typed === true} && field?.getAttribute('role') === 'combobox';
    const optionsVisible = () => {
      const ids = (field?.getAttribute('aria-controls') || field?.getAttribute('aria-owns') || '').split(/\\s+/).filter(Boolean);
      const roots = ids.length ? ids.map((id) => document.getElementById(id)).filter(Boolean) : [document];
      return roots.flatMap((root) => [...root.querySelectorAll('[role="option"]')])
        .some((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.bottom > 0 && r.top < innerHeight; });
    };
    // The marker arrives as a string Node built from a CDP-returned copy, whose
    // object keys the debugger transport reorders. Both sides are canonicalised
    // here so the comparison sees data, not key order.
    const canon = (v) => Array.isArray(v) ? v.map(canon)
      : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {})
        : v;
    const before = JSON.stringify(canon(JSON.parse(seen)));
    const cheap = () => location.href + '|' + scrollY + '|' + document.title;
    let done = false, differs = false, mutations = 0, seenMutations = -1;
    let lastCheap = cheap(), marker = null, stableSince = null, firstDiff = null, elements = -1;
    const start = performance.now();
    const observer = new MutationObserver(() => { mutations++; });
    const finish = (result) => {
      if (done) return;
      done = true; observer.disconnect(); clearInterval(tick);
      resolve({ changed: result, elements, fields: differs ? ['marker'] : [] });
    };
    const sample = () => {
      if (autocomplete) { differs = optionsVisible(); return; }
      const s = ${OBSERVE_SCRIPT};
      if (!s) { differs = true; marker = null; stableSince = performance.now(); return; }
      const next = JSON.stringify(canon(s.marker));
      elements = s.elements.length;
      differs = next !== before;
      if (next !== marker) { marker = next; stableSince = performance.now(); }
    };
    const tick = setInterval(() => {
      if (done) return;
      const now = performance.now();
      // Before anything changed, sampling is gated on a mutation, a navigation or a
      // scroll; afterwards the page is polled, because CSS transitions reveal
      // elements without mutating the DOM and the state must be seen to settle.
      if (firstDiff !== null || mutations !== seenMutations || cheap() !== lastCheap) {
        seenMutations = mutations; lastCheap = cheap(); sample();
      }
      if (!differs) { firstDiff = null; }
      else {
        if (firstDiff === null) firstDiff = now;
        // Settled once the observable state has held still, or the grace window is spent.
        else if ((stableSince !== null && now - stableSince >= 200) || now - firstDiff >= graceMs) return finish(true);
      }
      if (now - start >= timeoutMs) finish(differs);
    }, 30);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  }))(${JSON.stringify(JSON.stringify(page.marker))}, ${timeoutMs}, ${opts.graceMs})`
}

/**
 * Menus and panels that animate open take up to a second on a busy page, so the
 * cap has to outlast them; the grace window bounds what an endlessly animating
 * page can cost per action.
 */
const ACT_SETTLE_MS = 2000
const ACT_GRACE_MS = 1000

/**
 * After input: wait for the page to react to the action (menus that animate
 * in, suggestion lists, in-page navigation) instead of a fixed two frames.
 * Read-only; a navigation in the middle is not an error.
 */
export async function settleAfter(webContentsId: number, page: PageObservation, opts: { node?: number; typed?: boolean }): Promise<SettleOutcome> {
  try {
    return (await evaluate<SettleOutcome>(webContentsId, changeWaitExpr(page, ACT_SETTLE_MS, { ...opts, graceMs: ACT_GRACE_MS }), true))
      ?? { changed: true, fields: ['unknown'], elements: -1 }
  } catch {
    // navigating — the next observe retries until the document is back
    return { changed: true, fields: ['navigating'], elements: -1 }
  }
}

/**
 * Jev asked to wait: block until the page differs from the one it saw. A
 * navigation in the middle destroys the context and counts as a change.
 */
export async function waitForPageChange(webContentsId: number, page: PageObservation, timeoutMs: number): Promise<boolean> {
  try {
    return (await evaluate<SettleOutcome>(webContentsId, changeWaitExpr(page, timeoutMs, { graceMs: ACT_GRACE_MS }), true))?.changed === true
  } catch {
    return true // navigating — the next observe retries until the document is back
  }
}

/** Machine loading signal: readyState. Returns true once the document is complete or the wait expired. */
export async function waitForDocumentComplete(webContentsId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const ready = await evaluate<string>(webContentsId, 'document.readyState')
      if (ready === 'complete') return true
    } catch {
      // mid-navigation
    }
    await sleep(50)
  }
  return false
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Same vocabulary as `browser_wait_for` / `browser_act.expect`, plus a regex form for URLs. */
export interface DoneWhen {
  selector?: string
  selectorGone?: string
  text?: string
  urlIncludes?: string
  urlMatches?: string
}

export function hasDoneWhen(cond: DoneWhen | undefined): cond is DoneWhen {
  return !!cond && Object.values(cond).some((v) => typeof v === 'string' && v.length > 0)
}

/** Machine completion check; conditions are AND-combined. Never throws on a mid-navigation page. */
export async function checkDoneWhen(webContentsId: number, cond: DoneWhen): Promise<boolean> {
  const expr = `(() => {
    const c = ${JSON.stringify(cond)};
    const vis = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); };
    if (c.selector && !vis(c.selector)) return false;
    if (c.selectorGone && vis(c.selectorGone)) return false;
    if (c.text && !(document.body?.innerText || '').includes(c.text)) return false;
    if (c.urlIncludes && !location.href.includes(c.urlIncludes)) return false;
    if (c.urlMatches && !new RegExp(c.urlMatches).test(location.href)) return false;
    return true;
  })()`
  try {
    return (await evaluate<boolean>(webContentsId, expr)) === true
  } catch {
    return false
  }
}
