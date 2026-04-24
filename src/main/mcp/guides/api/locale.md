# Locale API

The host exposes the user's selected UI language so mini-apps can localize their own content.

Currently supported values: `'en'` | `'zh'`. Mini-apps should fall back to `'en'` if the returned value is unknown.

## Reading the Current Locale

```js
const lang = superone.locale.get()  // → 'en' | 'zh'
```

The value is baked into the bridge at page load, so `get()` is safe to call synchronously at startup (no race window).

## Subscribing to Changes

```js
const unsub = superone.locale.onChange(function(lang) {
  // lang: 'en' | 'zh'
  applyTranslations(lang)
})

// later:
unsub()
```

The callback fires **only on actual changes** — it is NOT invoked for the initial value. Read `superone.locale.get()` at boot to render the first state.

## Pattern: Translation Table

```js
const I18N = {
  en: { greeting: 'Hello', save: 'Save' },
  zh: { greeting: '你好',   save: '保存' },
}

function t(key) {
  const lang = superone.locale.get()
  return (I18N[lang] || I18N.en)[key] || key
}

function render() {
  document.getElementById('greeting').textContent = t('greeting')
  document.getElementById('save').textContent = t('save')
}

render()
superone.locale.onChange(render)
```

## Tips

- Keep your own translation dictionary inside the mini-app; the host does not expose its translations.
- Mirror the host's locale rather than shipping your own language picker — users expect the whole app (host + mini-apps) to follow a single language choice.
- If your mini-app supports more languages than the host, map the host's `'en'` / `'zh'` to your closest match and expose your own finer-grained selector.
