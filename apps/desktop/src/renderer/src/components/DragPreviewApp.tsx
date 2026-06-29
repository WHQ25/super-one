import { useEffect, useState } from 'react'
import { DragPreviewCard } from './sidebar/SessionDragPreviewContent'

export function DragPreviewApp(): React.JSX.Element {
  const [title, setTitle] = useState('')

  useEffect(() => window.app.onDragPreviewUpdate((data) => {
    setTitle(data.title)
    document.documentElement.classList.toggle('dark', data.dark)
  }), [])

  return (
    <div className="flex w-full justify-center pt-2">
      <DragPreviewCard title={title} />
    </div>
  )
}
