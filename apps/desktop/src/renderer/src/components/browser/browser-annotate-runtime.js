(function (config) {
  return new Promise(function (resolve) {
    if (window.__superoneAnnotateCancel) {
      try { window.__superoneAnnotateCancel() } catch (e) {}
    }

    var PREFIX = '__SUPERONE_ANNO__'
    var BOX_Z = 2147483640
    var CHROME_Z = 2147483646
    var SLIDERS_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>'
    var CHECK_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    var GRIP_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>'
    var TRASH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'

    var phase = 'idle'
    var dragStart = null
    var dragging = false
    var downEl = null
    var pending = null
    var markCount = 0
    var marksById = new Map()
    var styleChanges = {}
    var styleBaseline = {}

    var prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'

    var host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;margin:0;padding:0;border:0;cursor:crosshair;pointer-events:auto;z-index:' + CHROME_Z
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host
    var marks = document.createElement('div')
    marks.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:' + BOX_Z
    root.appendChild(marks)

    var style = document.createElement('style')
    style.textContent = [
      '.anno-sliders{appearance:none;background:transparent;color:' + config.mutedFg + '}',
      '.anno-sliders:hover{background:' + config.fill + '}',
      '.anno-sliders.active{background:' + config.primary + ';color:#fff}',
      '.anno-sliders.active:hover{background:' + config.primary + '}',
      '.anno-confirm{appearance:none;background:transparent;color:' + config.primary + ';cursor:pointer}',
      '.anno-confirm:disabled{color:' + config.mutedFg + ';cursor:not-allowed;opacity:.45}',
      '.anno-confirm:hover:not(:disabled){background:' + config.primary + ';color:#fff}',
      '.anno-trash{appearance:none;background:transparent;color:' + config.mutedFg + ';cursor:pointer}',
      '.anno-trash:hover{background:#dc2626;color:#fff}',
    ].join('')
    root.appendChild(style)

    function box(solid) {
      var b = document.createElement('div')
      b.style.cssText = [
        'position:fixed', 'display:none', 'pointer-events:none', 'box-sizing:border-box',
        'border:2px ' + (solid ? 'solid' : 'dashed') + ' ' + config.primary,
        'background:' + config.fill, 'border-radius:3px', 'z-index:' + BOX_Z,
      ].join(';')
      root.appendChild(b)
      return b
    }
    var hoverBox = box(false)
    var marqueeBox = box(false)
    var lockBox = box(true)

    // ---- editor card ----
    var editor = document.createElement('div')
    editor.style.cssText = [
      'position:fixed', 'display:none', 'flex-direction:column',
      'pointer-events:auto', 'box-sizing:border-box', 'width:268px', 'overflow:hidden',
      'border-radius:14px', 'cursor:auto', 'z-index:' + CHROME_Z,
      'background:' + config.bg, 'color:' + config.fg, 'border:1px solid ' + config.border,
      'box-shadow:0 12px 40px rgba(0,0,0,0.3)',
      'font:12px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif',
    ].join(';')

    var pillRow = document.createElement('div')
    pillRow.style.cssText = 'display:flex;align-items:center;gap:7px;padding:6px 8px'

    var slidersBtn = document.createElement('button')
    slidersBtn.type = 'button'
    slidersBtn.className = 'anno-sliders'
    slidersBtn.innerHTML = SLIDERS_SVG
    slidersBtn.style.cssText = [
      'display:none', 'flex:0 0 auto', 'width:26px', 'height:26px', 'border-radius:50%',
      'align-items:center', 'justify-content:center', 'cursor:pointer', 'border:0',
    ].join(';')

    var input = document.createElement('input')
    input.type = 'text'
    input.placeholder = config.placeholder
    input.style.cssText = [
      'flex:1', 'min-width:0', 'border:0', 'outline:none', 'background:transparent',
      'color:' + config.fg, 'font:13px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif',
    ].join(';')

    pillRow.appendChild(slidersBtn)
    pillRow.appendChild(input)
    editor.appendChild(pillRow)

    // ---- style panel (element only) ----
    var panelWrap = document.createElement('div')
    panelWrap.style.cssText = 'display:none;border-top:1px solid ' + config.border

    var headerRow = document.createElement('div')
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px'
    var tagLabel = document.createElement('span')
    tagLabel.style.cssText = 'font:600 12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;color:' + config.fg
    var dragHandle = document.createElement('span')
    dragHandle.innerHTML = GRIP_SVG
    dragHandle.style.cssText = 'cursor:grab;color:' + config.mutedFg + ';display:flex;align-items:center'
    headerRow.appendChild(tagLabel)
    headerRow.appendChild(dragHandle)
    panelWrap.appendChild(headerRow)

    var stylePanel = document.createElement('div')
    stylePanel.style.cssText = 'display:grid;grid-template-columns:66px 1fr;gap:6px 8px;align-items:center;padding:2px 10px 10px'
    panelWrap.appendChild(stylePanel)
    editor.appendChild(panelWrap)

    function applyStyle(property, value) {
      if (!pending || !pending.el) return
      var el = pending.el
      if (!(property in styleBaseline)) styleBaseline[property] = el.style.getPropertyValue(property)
      var prev = styleChanges[property] ? styleChanges[property].previousValue : null
      if (prev == null) prev = getComputedStyle(el).getPropertyValue(property).trim()
      el.style.setProperty(property, value, 'important')
      styleChanges[property] = { property: property, previousValue: prev, value: value }
      updateConfirmState()
    }
    function revertStyles() {
      if (!pending || !pending.el) return
      var el = pending.el
      for (var p in styleBaseline) {
        var b = styleBaseline[p]
        if (b) el.style.setProperty(p, b); else el.style.removeProperty(p)
      }
    }
    function rgbToHex(s) {
      var m = String(s).match(/\d+/g)
      if (!m || m.length < 3) return null
      function h(n) { n = parseInt(n, 10).toString(16); return n.length < 2 ? '0' + n : n }
      return '#' + h(m[0]) + h(m[1]) + h(m[2])
    }

    var fieldCss = 'box-sizing:border-box;min-width:0;width:100%;height:26px;border:1px solid ' + config.border + ';border-radius:8px;background:' + config.fill + ';color:' + config.fg + ';outline:none;font:12px ui-sans-serif,system-ui,-apple-system,sans-serif'
    function fieldRow(labelText, control) {
      var l = document.createElement('span')
      l.textContent = labelText
      l.style.cssText = 'font:400 12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;color:' + config.fg
      stylePanel.appendChild(l)
      stylePanel.appendChild(control)
    }
    function colorControl(property) {
      var wrap = document.createElement('div')
      wrap.style.cssText = 'display:flex;align-items:center;gap:7px;min-width:0;height:26px;box-sizing:border-box;border:1px solid ' + config.border + ';border-radius:8px;padding:0 8px;background:' + config.fill
      var c = document.createElement('input')
      c.type = 'color'
      c.style.cssText = 'width:16px;height:16px;padding:0;border:0;border-radius:3px;overflow:hidden;background:transparent;cursor:pointer;flex:0 0 auto'
      var t = document.createElement('input')
      t.type = 'text'
      t.style.cssText = 'min-width:0;flex:1;border:0;background:transparent;color:' + config.fg + ';outline:none;font:12px ui-monospace,monospace'
      c.addEventListener('input', function () { t.value = c.value; applyStyle(property, c.value) })
      t.addEventListener('change', function () {
        var v = t.value.trim()
        if (!v) return
        applyStyle(property, v)
        var hx = /^#[0-9a-f]{6}$/i.test(v) ? v : rgbToHex(v)
        if (hx) c.value = hx
      })
      wrap.appendChild(c); wrap.appendChild(t)
      return { wrap: wrap, c: c, t: t }
    }
    function unitControl(property, unit) {
      var wrap = document.createElement('div')
      wrap.style.cssText = 'display:flex;align-items:center;min-width:0;height:26px;box-sizing:border-box;border:1px solid ' + config.border + ';border-radius:8px;padding:0 8px;background:' + config.fill
      var i = document.createElement('input')
      i.type = 'number'
      i.style.cssText = 'min-width:0;flex:1;border:0;background:transparent;color:' + config.fg + ';outline:none;font:12px ui-sans-serif,system-ui,-apple-system,sans-serif'
      var u = document.createElement('span')
      u.textContent = unit
      u.style.cssText = 'flex:0 0 auto;color:' + config.mutedFg + ';font:12px ui-sans-serif,system-ui,-apple-system,sans-serif'
      i.addEventListener('input', function () { if (i.value !== '') applyStyle(property, i.value + unit) })
      wrap.appendChild(i); wrap.appendChild(u)
      return { wrap: wrap, i: i }
    }
    function selectControl(property, opts) {
      var s = document.createElement('select')
      var chevron = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="' + config.mutedFg + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>')
      s.style.cssText = [
        'box-sizing:border-box', 'min-width:0', 'width:100%', 'height:26px',
        'border:1px solid ' + config.border, 'border-radius:8px',
        'background-color:' + config.fill, 'background-image:url("' + chevron + '")',
        'background-repeat:no-repeat', 'background-position:right 8px center',
        'color:' + config.fg, 'outline:none',
        'font:12px ui-sans-serif,system-ui,-apple-system,sans-serif',
        'padding:0 26px 0 8px', 'cursor:pointer',
        'appearance:none', '-webkit-appearance:none',
      ].join(';')
      for (var i = 0; i < opts.length; i++) {
        var op = document.createElement('option')
        op.value = opts[i][0]; op.textContent = opts[i][1]
        s.appendChild(op)
      }
      s.addEventListener('change', function () { if (s.value) applyStyle(property, s.value) })
      return s
    }
    function textControl(property) {
      var i = document.createElement('input')
      i.type = 'text'
      i.style.cssText = fieldCss + ';padding:0 8px'
      i.addEventListener('change', function () { var v = i.value.trim(); if (v) applyStyle(property, v) })
      return i
    }

    var fColor = colorControl('color')
    var fBg = colorControl('background-color')
    var fSize = unitControl('font-size', 'px')
    var fWeight = selectControl('font-weight', [['', '—'], ['300', '300'], ['400', '400'], ['500', '500'], ['600', '600'], ['700', '700'], ['800', '800']])
    var fRadius = unitControl('border-radius', 'px')
    var fPadding = textControl('padding')
    fieldRow(config.sColor, fColor.wrap)
    fieldRow(config.sBg, fBg.wrap)
    fieldRow(config.sSize, fSize.wrap)
    fieldRow(config.sWeight, fWeight)
    fieldRow(config.sRadius, fRadius.wrap)
    fieldRow(config.sPadding, fPadding)

    function prefillControls(el) {
      var cs = getComputedStyle(el)
      fColor.t.value = cs.color; var ch = rgbToHex(cs.color); if (ch) fColor.c.value = ch
      fBg.t.value = cs.backgroundColor; var bh = rgbToHex(cs.backgroundColor); if (bh) fBg.c.value = bh
      fSize.i.value = String(parseFloat(cs.fontSize) || '')
      var w = String(cs.fontWeight === 'normal' ? '400' : cs.fontWeight === 'bold' ? '700' : cs.fontWeight)
      fWeight.value = /^(300|400|500|600|700|800)$/.test(w) ? w : ''
      fRadius.i.value = String(parseFloat(cs.borderRadius) || '')
      fPadding.value = cs.padding || ''
    }

    var confirmBtn = document.createElement('button')
    confirmBtn.type = 'button'
    confirmBtn.className = 'anno-confirm'
    confirmBtn.innerHTML = CHECK_SVG
    confirmBtn.style.cssText = [
      'flex:0 0 auto', 'width:26px', 'height:26px', 'border-radius:50%', 'border:0', 'cursor:pointer',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';')
    var trashBtn = document.createElement('button')
    trashBtn.type = 'button'
    trashBtn.className = 'anno-trash'
    trashBtn.innerHTML = TRASH_SVG
    trashBtn.style.cssText = [
      'display:none', 'flex:0 0 auto', 'width:26px', 'height:26px', 'border-radius:50%', 'border:0',
      'align-items:center', 'justify-content:center',
    ].join(';')
    pillRow.appendChild(trashBtn)
    pillRow.appendChild(confirmBtn)

    var shotRow = document.createElement('label')
    shotRow.style.cssText = 'grid-column:1 / -1;display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none;color:' + config.mutedFg + ';font:500 12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;padding-top:2px'
    var shotChk = document.createElement('input')
    shotChk.type = 'checkbox'
    shotChk.style.cssText = 'cursor:pointer;margin:0;width:12px;height:12px;accent-color:' + config.primary
    var shotTxt = document.createElement('span')
    shotTxt.textContent = config.screenshot
    shotRow.appendChild(shotChk); shotRow.appendChild(shotTxt)
    stylePanel.appendChild(shotRow)
    root.appendChild(editor)
    document.documentElement.appendChild(host)

    function rectOf(el) {
      var r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    }
    function normRect(x1, y1, x2, y2) {
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
    }
    function showBox(b, r) {
      b.style.left = r.x + 'px'; b.style.top = r.y + 'px'
      b.style.width = r.width + 'px'; b.style.height = r.height + 'px'
      b.style.display = 'block'
    }
    function clearBox(b) { b.style.display = 'none' }

    function drawMark(kind, r, num, id) {
      var regionEl = null
      var px, py
      if (kind === 'region') {
        regionEl = document.createElement('div')
        regionEl.style.cssText = [
          'position:fixed', 'box-sizing:border-box', 'pointer-events:none',
          'left:' + r.x + 'px', 'top:' + r.y + 'px', 'width:' + r.width + 'px', 'height:' + r.height + 'px',
          'border:2px solid ' + config.primary, 'background:' + config.fill, 'border-radius:3px',
        ].join(';')
        marks.appendChild(regionEl)
        px = r.x + r.width - 11
        py = r.y - 11
      } else {
        px = r.x + r.width / 2 - 11
        py = r.y + r.height / 2 - 11
      }
      px = Math.min(Math.max(2, px), window.innerWidth - 24)
      py = Math.min(Math.max(2, py), window.innerHeight - 24)
      var pin = document.createElement('div')
      pin.setAttribute('data-anno-pin', id)
      pin.textContent = String(num)
      pin.style.cssText = [
        'position:fixed', 'left:' + px + 'px', 'top:' + py + 'px',
        'min-width:22px', 'height:22px', 'box-sizing:border-box', 'padding:0 4px',
        'display:flex', 'align-items:center', 'justify-content:center', 'pointer-events:auto', 'cursor:pointer',
        'border-radius:11px 11px 11px 3px', 'background:' + config.primary, 'color:#fff',
        'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
        'font:600 12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif',
      ].join(';')
      pin.addEventListener('pointerdown', function (e) { e.stopPropagation() })
      pin.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation()
        if (phase === 'idle') beginEditExisting(id)
      })
      marks.appendChild(pin)
      marksById.set(id, { region: regionEl, pin: pin })
    }
    function removeMark(id) {
      var m = marksById.get(id)
      if (!m) return
      if (m.region) m.region.remove()
      if (m.pin) m.pin.remove()
      marksById.delete(id)
    }
    function clearMarks() {
      marksById.forEach(function (m) { if (m.region) m.region.remove(); if (m.pin) m.pin.remove() })
      marksById.clear()
    }

    function pickAt(x, y) {
      host.style.pointerEvents = 'none'
      var el = document.elementFromPoint(x, y)
      host.style.pointerEvents = 'auto'
      if (!el || el === document.documentElement || el === document.body) return null
      if (host.contains(el)) return null
      if (el.closest && el.closest('[data-anno-pin]')) return null
      return el
    }
    function cssEscape(v) {
      if (window.CSS && CSS.escape) return CSS.escape(v)
      return String(v).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
    function selectorOf(el) {
      if (!el || el.nodeType !== 1) return null
      if (el.id) return '#' + cssEscape(el.id)
      var parts = []
      var node = el
      var guard = 0
      while (node && node.nodeType === 1 && node !== document.body && guard < 5) {
        guard++
        var part = node.tagName.toLowerCase()
        if (node.id) { parts.unshift('#' + cssEscape(node.id)); break }
        var cls = []
        if (node.className && typeof node.className === 'string') {
          cls = node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
        }
        if (cls.length) {
          part += '.' + cls.map(cssEscape).join('.')
        }
        var parent = node.parentElement
        if (parent) {
          var same = []
          for (var i = 0; i < parent.children.length; i++) {
            if (parent.children[i].tagName === node.tagName) same.push(parent.children[i])
          }
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'
        }
        parts.unshift(part)
        node = node.parentElement
      }
      return parts.length ? parts.join(' > ') : null
    }

    function positionEditor(r) {
      var W = 268, H = 44, pad = 8
      var left = Math.min(Math.max(pad, r.x), window.innerWidth - W - pad)
      if (left < pad) left = pad
      var top = r.y + r.height + pad
      if (top + H > window.innerHeight) top = Math.max(pad, r.y - H)
      editor.style.left = left + 'px'
      editor.style.top = top + 'px'
    }

    function beginEdit(kind, r, selector, el) {
      phase = 'editing'
      pending = { kind: kind, rect: r, selector: selector, el: el || null }
      styleChanges = {}
      styleBaseline = {}
      host.style.cursor = 'auto'
      clearBox(hoverBox)
      showBox(lockBox, r)
      shotChk.checked = kind === 'region'
      panelWrap.style.display = 'none'
      slidersBtn.classList.remove('active')
      trashBtn.style.display = 'none'
      if (kind === 'element' && el) {
        slidersBtn.style.display = 'flex'
        tagLabel.textContent = el.tagName.toLowerCase()
        prefillControls(el)
      } else {
        slidersBtn.style.display = 'none'
      }
      positionEditor(r)
      editor.style.display = 'flex'
      input.value = ''
      updateConfirmState()
      try { input.focus() } catch (e) {}
    }
    function beginEditExisting(id) {
      var entry = marksById.get(id)
      if (!entry) return
      var d = entry.data
      phase = 'editing'
      pending = { kind: d.kind, rect: d.rect, selector: d.selector, el: d.el || null, id: id }
      styleChanges = {}
      styleBaseline = {}
      for (var i = 0; i < d.styleChanges.length; i++) {
        var c = d.styleChanges[i]
        styleChanges[c.property] = { property: c.property, previousValue: c.previousValue, value: c.value }
        styleBaseline[c.property] = c.value
      }
      host.style.cursor = 'auto'
      clearBox(hoverBox)
      showBox(lockBox, d.rect)
      shotChk.checked = !!d.wantScreenshot
      panelWrap.style.display = 'none'
      slidersBtn.classList.remove('active')
      trashBtn.style.display = 'flex'
      if (d.kind === 'element' && d.el && d.el.isConnected) {
        slidersBtn.style.display = 'flex'
        tagLabel.textContent = d.el.tagName.toLowerCase()
        prefillControls(d.el)
      } else {
        slidersBtn.style.display = 'none'
      }
      positionEditor(d.rect)
      editor.style.display = 'flex'
      input.value = d.comment || ''
      updateConfirmState()
      try { input.focus() } catch (e) {}
    }
    function closeEditor(keepStyles) {
      if (!keepStyles) revertStyles()
      phase = 'idle'
      pending = null
      host.style.cursor = 'crosshair'
      clearBox(lockBox)
      editor.style.display = 'none'
      trashBtn.style.display = 'none'
    }
    function updateConfirmState() {
      confirmBtn.disabled = !input.value.trim() && Object.keys(styleChanges).length === 0
    }
    function sendPayload(obj) {
      try { console.log(PREFIX + JSON.stringify(obj)) } catch (e) {}
    }
    function commit() {
      if (!pending) return
      if (!input.value.trim() && Object.keys(styleChanges).length === 0) return
      var changes = []
      for (var k in styleChanges) changes.push(styleChanges[k])
      var comment = input.value.trim()
      var wantShot = !!shotChk.checked
      if (pending.id) {
        var entry = marksById.get(pending.id)
        if (entry) {
          entry.data.comment = comment
          entry.data.styleChanges = changes
          entry.data.wantScreenshot = wantShot
        }
        sendPayload({
          op: 'update', id: pending.id, kind: pending.kind, rect: pending.rect,
          selector: pending.selector, comment: comment, wantScreenshot: wantShot,
          styleChanges: changes, pageUrl: location.href, pageTitle: document.title || '',
        })
        closeEditor(true)
        return
      }
      var id = crypto.randomUUID()
      markCount++
      drawMark(pending.kind, pending.rect, markCount, id)
      marksById.get(id).data = {
        kind: pending.kind, rect: pending.rect, selector: pending.selector, el: pending.el,
        comment: comment, styleChanges: changes, wantScreenshot: wantShot,
      }
      sendPayload({
        op: 'commit', id: id, kind: pending.kind, rect: pending.rect,
        selector: pending.selector, comment: comment, wantScreenshot: wantShot,
        styleChanges: changes, pageUrl: location.href, pageTitle: document.title || '',
      })
      closeEditor(true)
    }
    function deleteCurrent() {
      if (!pending || !pending.id) return
      var id = pending.id
      closeEditor(false)
      removeMark(id)
      sendPayload({ op: 'delete', id: id })
    }

    function cleanup() {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
      document.documentElement.style.overflow = prevOverflow
      try { host.remove() } catch (e) {}
      try { delete window.__superoneAnnotateCancel } catch (e) { window.__superoneAnnotateCancel = undefined }
      try { delete window.__superoneAnnotateHide } catch (e) { window.__superoneAnnotateHide = undefined }
      try { delete window.__superoneAnnotateShow } catch (e) { window.__superoneAnnotateShow = undefined }
      try { delete window.__superoneAnnotateRemoveMark } catch (e) { window.__superoneAnnotateRemoveMark = undefined }
      try { delete window.__superoneAnnotateClearMarks } catch (e) { window.__superoneAnnotateClearMarks = undefined }
    }
    function finishAll() {
      if (phase === 'editing') revertStyles()
      cleanup()
      resolve(null)
    }

    function onMove(e) {
      if (phase !== 'idle') return
      if (dragStart) {
        var dx = Math.abs(e.clientX - dragStart.x), dy = Math.abs(e.clientY - dragStart.y)
        if (dragging || dx > 4 || dy > 4) {
          dragging = true
          clearBox(hoverBox)
          showBox(marqueeBox, normRect(dragStart.x, dragStart.y, e.clientX, e.clientY))
        }
        return
      }
      var el = pickAt(e.clientX, e.clientY)
      if (el) showBox(hoverBox, rectOf(el)); else clearBox(hoverBox)
    }
    function onDown(e) {
      if (phase !== 'idle' || e.button !== 0) return
      if (e.target && e.target.closest && e.target.closest('[data-anno-pin]')) return
      e.preventDefault(); e.stopPropagation()
      dragStart = { x: e.clientX, y: e.clientY }
      downEl = pickAt(e.clientX, e.clientY)
    }
    function onUp(e) {
      if (phase !== 'idle' || !dragStart) return
      e.preventDefault(); e.stopPropagation()
      var ds = dragStart; dragStart = null
      if (dragging) {
        dragging = false
        clearBox(marqueeBox)
        var r = normRect(ds.x, ds.y, e.clientX, e.clientY)
        if (r.width >= 8 && r.height >= 8) { beginEdit('region', r, null, null); return }
      }
      var el = downEl || pickAt(e.clientX, e.clientY)
      if (el) beginEdit('element', rectOf(el), selectorOf(el), el)
    }
    function inEditor(e) {
      try {
        var path = e.composedPath()
        for (var i = 0; i < path.length; i++) { if (path[i] === editor) return true }
      } catch (err) {}
      return false
    }
    function isPinTarget(e) {
      try {
        var path = e.composedPath()
        for (var i = 0; i < path.length; i++) {
          var n = path[i]
          if (n && n.getAttribute && n.getAttribute('data-anno-pin')) return true
        }
      } catch (err) {}
      return false
    }
    function onClick(e) {
      if (inEditor(e) || isPinTarget(e)) return
      e.preventDefault(); e.stopPropagation()
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (phase === 'editing') closeEditor(false); else finishAll()
        return
      }
      if (phase === 'editing' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && inEditor(e)) { e.preventDefault(); commit() }
    }

    // editor drag via handle
    var moveDrag = null
    dragHandle.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation()
      var rect = editor.getBoundingClientRect()
      moveDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
      dragHandle.style.cursor = 'grabbing'
      window.addEventListener('pointermove', onDragMove, true)
      window.addEventListener('pointerup', onDragUp, true)
    })
    function onDragMove(e) {
      if (!moveDrag) return
      editor.style.left = Math.max(2, Math.min(e.clientX - moveDrag.dx, window.innerWidth - 60)) + 'px'
      editor.style.top = Math.max(2, Math.min(e.clientY - moveDrag.dy, window.innerHeight - 40)) + 'px'
    }
    function onDragUp() {
      moveDrag = null
      dragHandle.style.cursor = 'grab'
      window.removeEventListener('pointermove', onDragMove, true)
      window.removeEventListener('pointerup', onDragUp, true)
    }

    slidersBtn.addEventListener('click', function (e) {
      e.preventDefault()
      var open = panelWrap.style.display !== 'block'
      panelWrap.style.display = open ? 'block' : 'none'
      if (open) slidersBtn.classList.add('active'); else slidersBtn.classList.remove('active')
    })
    confirmBtn.addEventListener('click', function (e) { e.preventDefault(); commit() })
    trashBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); deleteCurrent() })
    input.addEventListener('input', updateConfirmState)
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    window.__superoneAnnotateCancel = finishAll
    window.__superoneAnnotateHide = function () { marks.style.visibility = 'hidden' }
    window.__superoneAnnotateShow = function () { marks.style.visibility = 'visible' }
    window.__superoneAnnotateRemoveMark = removeMark
    window.__superoneAnnotateClearMarks = clearMarks
  })
})
