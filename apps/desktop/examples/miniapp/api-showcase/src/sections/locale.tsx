import { useEffect, useState } from 'react'
import { Languages } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Out } from '../components/kit'

const I18N = {
  en: { greeting: 'Hello from the showcase!', hint: 'Switch the host language.' },
  zh: { greeting: '你好，这是能力演示！', hint: '切换宿主语言试试。' },
}

function Demo() {
  const [lang, setLang] = useState(window.superone.locale.get())

  useEffect(() => {
    // onChange fires only on real changes — read get() for the initial value.
    const off = window.superone.locale.onChange(setLang)
    return off
  }, [])

  const dict = I18N[lang as keyof typeof I18N] ?? I18N.en
  return (
    <div>
      <div className="text-base font-medium">{dict.greeting}</div>
      <Out>
        current locale: {lang}
        {'\n'}
        {dict.hint}
      </Out>
    </div>
  )
}

const react = `import { useEffect, useState } from 'react'

const I18N = {
  en: { save: 'Save' },
  zh: { save: '保存' },
}

function SaveButton() {
  const [lang, setLang] = useState(window.superone.locale.get())
  useEffect(() => window.superone.locale.onChange(setLang), [])
  return <button>{(I18N[lang] ?? I18N.en).save}</button>
}`

const vanilla = `const I18N = {
  en: { greeting: 'Hello', save: 'Save' },
  zh: { greeting: '你好',  save: '保存' },
}
function t(key) {
  const lang = superone.locale.get()        // 'en' | 'zh'
  return (I18N[lang] || I18N.en)[key] || key
}
function render() {
  document.getElementById('g').textContent = t('greeting')
}
render()
superone.locale.onChange(render)             // fires only on change`

export const localeSection: SectionDef = {
  id: 'locale',
  icon: Languages,
  title: 'Locale',
  api: 'superone.locale',
  blurb:
    "Mirror the host's UI language (en | zh). Read locale.get() at boot; onChange fires only on actual changes.",
  Demo,
  react,
  vanilla,
}
