import type { ITheme } from '@xterm/xterm'

export type TerminalScheme = 'light' | 'dark'

export type AnsiColors = Pick<
  ITheme,
  | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
  | 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow'
  | 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite'
>

export interface TerminalPalette {
  id: string
  name: string
  ansi: AnsiColors
}

export const DEFAULT_DARK_PALETTE_ID = 'monokai-remastered'
export const DEFAULT_LIGHT_PALETTE_ID = 'catppuccin-latte'

// 16-color ANSI palettes from Ghostty's bundled themes
// (upstream: github.com/mbadolato/iTerm2-Color-Schemes, ghostty/).
export const DARK_TERMINAL_PALETTES: TerminalPalette[] = [
  {
    id: 'monokai-remastered',
    name: 'Monokai Remastered',
    ansi: {
      black: '#1a1a1a', red: '#f4005f', green: '#98e024', yellow: '#fd971f',
      blue: '#9d65ff', magenta: '#f4005f', cyan: '#58d1eb', white: '#c4c5b5',
      brightBlack: '#625e4c', brightRed: '#f4005f', brightGreen: '#98e024', brightYellow: '#e0d561',
      brightBlue: '#9d65ff', brightMagenta: '#f4005f', brightCyan: '#58d1eb', brightWhite: '#f6f6ef',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    ansi: {
      black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
      blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#a6adc8',
      brightBlack: '#585b70', brightRed: '#f37799', brightGreen: '#89d88b', brightYellow: '#ebd391',
      brightBlue: '#74a8fc', brightMagenta: '#f2aede', brightCyan: '#6bd7ca', brightWhite: '#bac2de',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    ansi: {
      black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
      blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
      brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68',
      brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula+',
    ansi: {
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#ffcb6b',
      blue: '#82aaff', magenta: '#c792ea', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#545454', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffcb6b',
      brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#f8f8f2',
    },
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    ansi: {
      black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
      blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
      brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f',
      brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    ansi: {
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#596377', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
    },
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    ansi: {
      black: '#26233a', red: '#eb6f92', green: '#31748f', yellow: '#f6c177',
      blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4',
      brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#31748f', brightYellow: '#f6c177',
      brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ebbcba', brightWhite: '#e0def4',
    },
  },
]

export const LIGHT_TERMINAL_PALETTES: TerminalPalette[] = [
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    ansi: {
      black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d',
      blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#acb0be',
      brightBlack: '#6c6f85', brightRed: '#de293e', brightGreen: '#49af3d', brightYellow: '#eea02d',
      brightBlue: '#456eff', brightMagenta: '#fe85d8', brightCyan: '#2d9fa8', brightWhite: '#bcc0cc',
    },
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    ansi: {
      black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00',
      blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
      brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01',
      brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
    },
  },
  {
    id: 'atom-one-light',
    name: 'Atom One Light',
    ansi: {
      black: '#000000', red: '#de3e35', green: '#3f953a', yellow: '#d2b67c',
      blue: '#2f5af3', magenta: '#950095', cyan: '#3f953a', white: '#bbbbbb',
      brightBlack: '#000000', brightRed: '#de3e35', brightGreen: '#3f953a', brightYellow: '#d2b67c',
      brightBlue: '#2f5af3', brightMagenta: '#a00095', brightCyan: '#3f953a', brightWhite: '#ffffff',
    },
  },
  {
    id: 'ayu-light',
    name: 'Ayu Light',
    ansi: {
      black: '#000000', red: '#ea6c6d', green: '#6cbf43', yellow: '#eca944',
      blue: '#3199e1', magenta: '#9e75c7', cyan: '#46ba94', white: '#bababa',
      brightBlack: '#686868', brightRed: '#f07171', brightGreen: '#86b300', brightYellow: '#f2ae49',
      brightBlue: '#399ee6', brightMagenta: '#a37acc', brightCyan: '#4cbf99', brightWhite: '#d1d1d1',
    },
  },
  {
    id: 'dayfox',
    name: 'Dayfox',
    ansi: {
      black: '#352c24', red: '#a5222f', green: '#396847', yellow: '#ac5402',
      blue: '#2848a9', magenta: '#6e33ce', cyan: '#287980', white: '#bfb6ae',
      brightBlack: '#534c45', brightRed: '#b3434e', brightGreen: '#577f63', brightYellow: '#b86e28',
      brightBlue: '#4863b6', brightMagenta: '#8452d5', brightCyan: '#488d93', brightWhite: '#f4ece6',
    },
  },
  {
    id: 'bluloco-light',
    name: 'Bluloco Light',
    ansi: {
      black: '#373a41', red: '#d52753', green: '#23974a', yellow: '#df631c',
      blue: '#275fe4', magenta: '#823ff1', cyan: '#27618d', white: '#babbc2',
      brightBlack: '#676a77', brightRed: '#ff6480', brightGreen: '#3cbc66', brightYellow: '#c5a332',
      brightBlue: '#0099e1', brightMagenta: '#ce33c0', brightCyan: '#6d93bb', brightWhite: '#d3d3d3',
    },
  },
]

const PALETTES_BY_SCHEME: Record<TerminalScheme, Map<string, TerminalPalette>> = {
  dark: new Map(DARK_TERMINAL_PALETTES.map((p) => [p.id, p])),
  light: new Map(LIGHT_TERMINAL_PALETTES.map((p) => [p.id, p])),
}

export function getTerminalPalette(id: string | null | undefined, scheme: TerminalScheme): TerminalPalette {
  const map = PALETTES_BY_SCHEME[scheme]
  const fallbackId = scheme === 'dark' ? DEFAULT_DARK_PALETTE_ID : DEFAULT_LIGHT_PALETTE_ID
  return (id ? map.get(id) : undefined) ?? map.get(fallbackId)!
}

export function terminalPalettesFor(scheme: TerminalScheme): TerminalPalette[] {
  return scheme === 'dark' ? DARK_TERMINAL_PALETTES : LIGHT_TERMINAL_PALETTES
}

export const TERMINAL_FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] as const
export const DEFAULT_TERMINAL_FONT_SIZE = 14

export function clampTerminalFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TERMINAL_FONT_SIZE
  return Math.min(22, Math.max(12, Math.round(value)))
}
