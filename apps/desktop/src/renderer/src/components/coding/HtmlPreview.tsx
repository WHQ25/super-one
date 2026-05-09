interface HtmlPreviewProps {
  src: string
}

export function HtmlPreview({ src }: HtmlPreviewProps) {
  return (
    <div className="relative size-full" style={{ minWidth: 0 }}>
      <iframe
        src={src}
        sandbox="allow-scripts"
        title="HTML Preview"
        style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%' }}
      />
    </div>
  )
}
