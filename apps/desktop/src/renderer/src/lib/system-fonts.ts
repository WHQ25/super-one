interface FontData {
  family: string
  fullName: string
  postscriptName: string
  style: string
}

type QueryLocalFonts = () => Promise<FontData[]>

export interface SystemFonts {
  all: string[]
  monospace: string[]
}

function isMonospace(family: string, ctx: CanvasRenderingContext2D): boolean {
  ctx.font = `16px "${family.replace(/"/g, '')}"`
  const narrow = ctx.measureText('iiiiiiiiii').width
  const wide = ctx.measureText('MMMMMMMMMM').width
  return Math.abs(narrow - wide) < 0.5
}

let cache: SystemFonts | null = null

export async function listSystemFonts(): Promise<SystemFonts> {
  if (cache) return cache
  const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts
  if (!query) return { all: [], monospace: [] }
  let fonts: FontData[]
  try {
    fonts = await query.call(window)
  } catch {
    return { all: [], monospace: [] }
  }
  const families = Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) => a.localeCompare(b))
  const ctx = document.createElement('canvas').getContext('2d')
  const monospace = ctx ? families.filter((f) => isMonospace(f, ctx)) : []
  cache = { all: families, monospace }
  return cache
}
