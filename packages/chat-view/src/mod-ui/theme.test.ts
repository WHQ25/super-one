import { describe, expect, it } from 'vitest'
import { modBackdropGlassStyle, modPaneBackground, parseModBackdropProps, parseModThemeStyle } from './theme'

describe('mod theme & backdrop helpers', () => {
  it('maps valid theme tokens, CSS variables, palette colors and aliases while dropping unsafe values', () => {
    const style = parseModThemeStyle(
      {
        colors: {
          background: '#1a1b26',
          cardForeground: 'rgb(200, 210, 220)',
          '--custom-accent': 'oklch(0.7 0.15 250)',
          red: '#f7768e',
          claude: '#7aa2f7',
          unsafe: 'url(javascript:alert(1))',
          '--bad_var!': '#fff',
        },
      },
      'dark',
    ) as Record<string, string>

    expect(style['--background']).toBe('#1a1b26')
    expect(style['--card-foreground']).toBe('rgb(200, 210, 220)')
    expect(style['--custom-accent']).toBe('oklch(0.7 0.15 250)')
    expect(style['--mod-red']).toBe('#f7768e')
    expect(style['--primary']).toBe('#7aa2f7')
    expect(style['--bad_var!']).toBeUndefined()
    expect(Object.values(style).some((v) => v.includes('javascript'))).toBe(false)
  })

  it('selects scheme-scoped colors when light/dark maps are provided', () => {
    const props = {
      colors: {
        light: { background: '#ffffff', primary: '#111111' },
        dark: { background: '#0f111a', primary: '#82aaff' },
      },
    }
    expect((parseModThemeStyle(props, 'light') as Record<string, string>)['--background']).toBe('#ffffff')
    expect((parseModThemeStyle(props, 'dark') as Record<string, string>)['--background']).toBe('#0f111a')
  })

  it('parses backdrop glass props and pane backgroundColor safely', () => {
    expect(parseModBackdropProps({ id: 'bg', plugin: 'theme-mod', glass: { blur: 20, opacity: 0.5, tint: '#112233' } })).toEqual({
      id: 'bg',
      plugin: 'theme-mod',
      glass: { blur: 20, opacity: 0.5, tint: '#112233' },
    })
    expect(parseModBackdropProps({ id: 'bg', glass: false })).toEqual({
      id: 'bg',
      plugin: undefined,
      glass: false,
    })
    expect(modBackdropGlassStyle(false)).toBeUndefined()
    expect(modBackdropGlassStyle({ blur: 12, opacity: 0.5, tint: '#112233' })).toEqual({
      backgroundColor: 'color-mix(in srgb, #112233 50%, transparent)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
    })
    expect(modPaneBackground('transparent')).toBe('transparent')
    expect(modPaneBackground('claude')).toBe('var(--primary)')
    expect(modPaneBackground('expression(alert(1))')).toBeUndefined()
  })
})
