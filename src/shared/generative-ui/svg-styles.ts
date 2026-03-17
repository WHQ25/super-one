export const SVG_STYLES = `
:root {
  --p: #2C2926;
  --s: #817B74;
  --t: #A9A49E;
  --bg2: #F5F1EA;
  --b: #E5E0D8;
  --color-text-primary: #2C2926;
  --color-text-secondary: #817B74;
  --color-text-tertiary: #A9A49E;
  --color-text-info: #185FA5;
  --color-text-danger: #A32D2D;
  --color-text-success: #3B6D11;
  --color-text-warning: #854F0B;
  --color-background-primary: #FEFCF9;
  --color-background-secondary: #F5F1EA;
  --color-background-tertiary: #EDEAD4;
  --color-background-info: #E6F1FB;
  --color-background-danger: #FCEBEB;
  --color-background-success: #EAF3DE;
  --color-background-warning: #FAEEDA;
  --color-border-primary: rgba(44,41,38,0.25);
  --color-border-secondary: rgba(44,41,38,0.15);
  --color-border-tertiary: rgba(44,41,38,0.10);
  --color-border-info: #378ADD;
  --color-border-danger: #E24B4A;
  --color-border-success: #639922;
  --color-border-warning: #EF9F27;
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-serif: Georgia, serif;
  --font-mono: ui-monospace, monospace;
  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;
  --c-purple-fill: #EEEDFE; --c-purple-stroke: #534AB7; --c-purple-title: #3C3489; --c-purple-sub: #534AB7;
  --c-teal-fill: #E1F5EE; --c-teal-stroke: #0F6E56; --c-teal-title: #085041; --c-teal-sub: #0F6E56;
  --c-coral-fill: #FAECE7; --c-coral-stroke: #993C1D; --c-coral-title: #712B13; --c-coral-sub: #993C1D;
  --c-pink-fill: #FBEAF0; --c-pink-stroke: #993556; --c-pink-title: #72243E; --c-pink-sub: #993556;
  --c-gray-fill: #F1EFE8; --c-gray-stroke: #5F5E5A; --c-gray-title: #444441; --c-gray-sub: #5F5E5A;
  --c-blue-fill: #E6F1FB; --c-blue-stroke: #185FA5; --c-blue-title: #0C447C; --c-blue-sub: #185FA5;
  --c-green-fill: #EAF3DE; --c-green-stroke: #3B6D11; --c-green-title: #27500A; --c-green-sub: #3B6D11;
  --c-amber-fill: #FAEEDA; --c-amber-stroke: #854F0B; --c-amber-title: #633806; --c-amber-sub: #854F0B;
  --c-red-fill: #FCEBEB; --c-red-stroke: #A32D2D; --c-red-title: #791F1F; --c-red-sub: #A32D2D;
}

.dark {
  --p: #e0e0e0;
  --s: #a0a0a0;
  --t: #707070;
  --bg2: #2a2a2a;
  --b: #404040;
  --color-text-primary: #e0e0e0;
  --color-text-secondary: #a0a0a0;
  --color-text-tertiary: #707070;
  --color-text-info: #85B7EB;
  --color-text-danger: #F09595;
  --color-text-success: #97C459;
  --color-text-warning: #EF9F27;
  --color-background-primary: #1a1a1a;
  --color-background-secondary: #2a2a2a;
  --color-background-tertiary: #111111;
  --color-background-info: #0C447C;
  --color-background-danger: #791F1F;
  --color-background-success: #27500A;
  --color-background-warning: #633806;
  --color-border-primary: rgba(255,255,255,0.4);
  --color-border-secondary: rgba(255,255,255,0.3);
  --color-border-tertiary: rgba(255,255,255,0.15);
  --color-border-info: #85B7EB;
  --color-border-danger: #F09595;
  --color-border-success: #97C459;
  --color-border-warning: #EF9F27;
  --c-purple-fill: #3C3489; --c-purple-stroke: #AFA9EC; --c-purple-title: #CECBF6; --c-purple-sub: #AFA9EC;
  --c-teal-fill: #085041; --c-teal-stroke: #5DCAA5; --c-teal-title: #9FE1CB; --c-teal-sub: #5DCAA5;
  --c-coral-fill: #712B13; --c-coral-stroke: #F0997B; --c-coral-title: #F5C4B3; --c-coral-sub: #F0997B;
  --c-pink-fill: #72243E; --c-pink-stroke: #ED93B1; --c-pink-title: #F4C0D1; --c-pink-sub: #ED93B1;
  --c-gray-fill: #444441; --c-gray-stroke: #B4B2A9; --c-gray-title: #D3D1C7; --c-gray-sub: #B4B2A9;
  --c-blue-fill: #0C447C; --c-blue-stroke: #85B7EB; --c-blue-title: #B5D4F4; --c-blue-sub: #85B7EB;
  --c-green-fill: #27500A; --c-green-stroke: #97C459; --c-green-title: #C0DD97; --c-green-sub: #97C459;
  --c-amber-fill: #633806; --c-amber-stroke: #EF9F27; --c-amber-title: #FAC775; --c-amber-sub: #EF9F27;
  --c-red-fill: #791F1F; --c-red-stroke: #F09595; --c-red-title: #F7C1C1; --c-red-sub: #F09595;
}

svg .t  { font-family: var(--font-sans); font-size: 14px; fill: var(--p); }
svg .ts { font-family: var(--font-sans); font-size: 12px; fill: var(--s); }
svg .th { font-family: var(--font-sans); font-size: 14px; font-weight: 500; fill: var(--p); }

svg .box { fill: var(--bg2); stroke: var(--b); }

svg .node { cursor: pointer; }
svg .node:hover { opacity: 0.8; }

svg .arr { stroke: var(--t); stroke-width: 1.5; fill: none; }

svg .leader { stroke: var(--t); stroke-width: 0.5; stroke-dasharray: 4 3; fill: none; }

svg .c-purple > rect, svg .c-purple > circle, svg .c-purple > ellipse { fill: var(--c-purple-fill); stroke: var(--c-purple-stroke); }
svg .c-purple > .th, svg .c-purple > .t { fill: var(--c-purple-title); }
svg .c-purple > .ts { fill: var(--c-purple-sub); }
svg rect.c-purple, svg circle.c-purple, svg ellipse.c-purple { fill: var(--c-purple-fill); stroke: var(--c-purple-stroke); }

svg .c-teal > rect, svg .c-teal > circle, svg .c-teal > ellipse { fill: var(--c-teal-fill); stroke: var(--c-teal-stroke); }
svg .c-teal > .th, svg .c-teal > .t { fill: var(--c-teal-title); }
svg .c-teal > .ts { fill: var(--c-teal-sub); }
svg rect.c-teal, svg circle.c-teal, svg ellipse.c-teal { fill: var(--c-teal-fill); stroke: var(--c-teal-stroke); }

svg .c-coral > rect, svg .c-coral > circle, svg .c-coral > ellipse { fill: var(--c-coral-fill); stroke: var(--c-coral-stroke); }
svg .c-coral > .th, svg .c-coral > .t { fill: var(--c-coral-title); }
svg .c-coral > .ts { fill: var(--c-coral-sub); }
svg rect.c-coral, svg circle.c-coral, svg ellipse.c-coral { fill: var(--c-coral-fill); stroke: var(--c-coral-stroke); }

svg .c-pink > rect, svg .c-pink > circle, svg .c-pink > ellipse { fill: var(--c-pink-fill); stroke: var(--c-pink-stroke); }
svg .c-pink > .th, svg .c-pink > .t { fill: var(--c-pink-title); }
svg .c-pink > .ts { fill: var(--c-pink-sub); }
svg rect.c-pink, svg circle.c-pink, svg ellipse.c-pink { fill: var(--c-pink-fill); stroke: var(--c-pink-stroke); }

svg .c-gray > rect, svg .c-gray > circle, svg .c-gray > ellipse { fill: var(--c-gray-fill); stroke: var(--c-gray-stroke); }
svg .c-gray > .th, svg .c-gray > .t { fill: var(--c-gray-title); }
svg .c-gray > .ts { fill: var(--c-gray-sub); }
svg rect.c-gray, svg circle.c-gray, svg ellipse.c-gray { fill: var(--c-gray-fill); stroke: var(--c-gray-stroke); }

svg .c-blue > rect, svg .c-blue > circle, svg .c-blue > ellipse { fill: var(--c-blue-fill); stroke: var(--c-blue-stroke); }
svg .c-blue > .th, svg .c-blue > .t { fill: var(--c-blue-title); }
svg .c-blue > .ts { fill: var(--c-blue-sub); }
svg rect.c-blue, svg circle.c-blue, svg ellipse.c-blue { fill: var(--c-blue-fill); stroke: var(--c-blue-stroke); }

svg .c-green > rect, svg .c-green > circle, svg .c-green > ellipse { fill: var(--c-green-fill); stroke: var(--c-green-stroke); }
svg .c-green > .th, svg .c-green > .t { fill: var(--c-green-title); }
svg .c-green > .ts { fill: var(--c-green-sub); }
svg rect.c-green, svg circle.c-green, svg ellipse.c-green { fill: var(--c-green-fill); stroke: var(--c-green-stroke); }

svg .c-amber > rect, svg .c-amber > circle, svg .c-amber > ellipse { fill: var(--c-amber-fill); stroke: var(--c-amber-stroke); }
svg .c-amber > .th, svg .c-amber > .t { fill: var(--c-amber-title); }
svg .c-amber > .ts { fill: var(--c-amber-sub); }
svg rect.c-amber, svg circle.c-amber, svg ellipse.c-amber { fill: var(--c-amber-fill); stroke: var(--c-amber-stroke); }

svg .c-red > rect, svg .c-red > circle, svg .c-red > ellipse { fill: var(--c-red-fill); stroke: var(--c-red-stroke); }
svg .c-red > .th, svg .c-red > .t { fill: var(--c-red-title); }
svg .c-red > .ts { fill: var(--c-red-sub); }
svg rect.c-red, svg circle.c-red, svg ellipse.c-red { fill: var(--c-red-fill); stroke: var(--c-red-stroke); }

button {
  background: transparent;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  color: var(--color-text-primary);
  padding: 6px 14px;
  font-size: 14px;
  cursor: pointer;
  font-family: var(--font-sans);
}
button:hover { background: var(--color-background-secondary); }
button:active { transform: scale(0.98); }

input[type="range"] {
  -webkit-appearance: none;
  height: 4px;
  background: var(--color-border-secondary);
  border-radius: 2px;
  outline: none;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-text-primary);
  cursor: pointer;
}

input[type="text"], input[type="number"], textarea, select {
  height: 36px;
  background: var(--color-background-primary);
  border: 0.5px solid var(--color-border-tertiary);
  border-radius: var(--border-radius-md);
  color: var(--color-text-primary);
  padding: 0 10px;
  font-size: 14px;
  font-family: var(--font-sans);
  outline: none;
}
input[type="text"]:hover, input[type="number"]:hover, textarea:hover, select:hover {
  border-color: var(--color-border-secondary);
}
input[type="text"]:focus, input[type="number"]:focus, textarea:focus, select:focus {
  border-color: var(--color-border-primary);
  box-shadow: 0 0 0 2px rgba(44,41,38,0.06);
}
.dark input[type="text"]:focus, .dark input[type="number"]:focus, .dark textarea:focus, .dark select:focus {
  box-shadow: 0 0 0 2px rgba(255,255,255,0.1);
}
`
