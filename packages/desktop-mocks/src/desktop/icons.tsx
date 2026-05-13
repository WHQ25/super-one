export type Harness = "claude" | "codex"

interface AgentIconProps {
  className?: string
}

export function ClaudeAgentIcon({ className = "size-16" }: AgentIconProps) {
  return (
    <svg viewBox="-3 -3 116 90" className={className} shapeRendering="crispEdges">
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0;2,-2;0,0;-2,-2;0,0"
          dur="2.5s"
          repeatCount="indefinite"
        />
        <g fill="#E07B4A">
          <rect x="10" y="0" width="90" height="60" />
          <rect x="0" y="20" width="10" height="20" />
          <rect x="100" y="20" width="10" height="20" />
        </g>
        <g fill="#1a1a1a">
          <rect x="20" y="20" width="10" height="10" />
          <rect x="80" y="20" width="10" height="10" />
          <animate
            attributeName="opacity"
            values="1;1;0;1;1"
            keyTimes="0;0.46;0.48;0.50;1"
            dur="4s"
            repeatCount="indefinite"
          />
        </g>
        <g fill="#E07B4A">
          <rect x="10" y="60" width="10" height="20">
            <animate attributeName="height" values="20;24;20;16;20" dur="2.5s" repeatCount="indefinite" />
          </rect>
          <rect x="30" y="60" width="10" height="20">
            <animate attributeName="height" values="20;24;20;16;20" dur="2.5s" repeatCount="indefinite" />
          </rect>
          <rect x="70" y="60" width="10" height="20">
            <animate attributeName="height" values="20;16;20;24;20" dur="2.5s" repeatCount="indefinite" />
          </rect>
          <rect x="90" y="60" width="10" height="20">
            <animate attributeName="height" values="20;16;20;24;20" dur="2.5s" repeatCount="indefinite" />
          </rect>
        </g>
      </g>
    </svg>
  )
}

export function CodexAgentIcon({ className = "size-16" }: AgentIconProps) {
  return (
    <svg viewBox="1 1 22 22" className={className}>
      <defs>
        <path
          id="codex-mock-cloud"
          d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388z"
        />
        <radialGradient id="codex-mock-base" cx="8" cy="6" r="22" fx="6" fy="3" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FAFAFF" />
          <stop offset="12%" stopColor="#DCE0FF" />
          <stop offset="28%" stopColor="#B1A7FF" />
          <stop offset="46%" stopColor="#7A9DFF" />
          <stop offset="62%" stopColor="#4F6BE8" />
          <stop offset="80%" stopColor="#3941FF" />
          <stop offset="100%" stopColor="#241889" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            values="0 0;5 4;0 0;-5 -4;0 0"
            dur="7s"
            repeatCount="indefinite"
          />
        </radialGradient>
        <radialGradient id="codex-mock-warm" cx="18" cy="20" r="15" fx="20" fy="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#D14EE8" stopOpacity="0.85" />
          <stop offset="40%" stopColor="#9045D8" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#5530B0" stopOpacity="0" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            values="0 0;-4 -3;0 0;4 3;0 0"
            dur="9s"
            repeatCount="indefinite"
          />
        </radialGradient>
        <radialGradient id="codex-mock-spec" cx="7" cy="4" r="5" fx="7" fy="3" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            values="0 0;1.5 1;0 0;-1.5 -1;0 0"
            dur="5s"
            repeatCount="indefinite"
          />
        </radialGradient>
      </defs>
      <g transform="translate(12 12)">
        <g>
          <animateTransform attributeName="transform" type="scale" values="1;1.04;1" dur="3.2s" repeatCount="indefinite" />
          <g transform="translate(-12 -12)">
            <use href="#codex-mock-cloud" fill="url(#codex-mock-base)" />
            <use href="#codex-mock-cloud" fill="url(#codex-mock-warm)" />
            <use href="#codex-mock-cloud" fill="url(#codex-mock-spec)" />
            <path
              d="M8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z"
              fill="#fff"
            />
            <path d="M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636z" fill="#fff">
              <animate
                attributeName="opacity"
                values="1;1;0;0;1"
                keyTimes="0;0.48;0.5;0.98;1"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </path>
          </g>
        </g>
      </g>
    </svg>
  )
}
