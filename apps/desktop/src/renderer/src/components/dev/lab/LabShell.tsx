import { useState } from 'react'
import { DragHeader } from './DragHeader'
import { LabHome } from './LabHome'
import { LABS } from './registry'

export function LabShell() {
  const [labId, setLabId] = useState<string | null>(null)
  const lab = LABS.find((l) => l.id === labId) ?? null
  const Lab = lab?.component

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <DragHeader title={lab?.title} onBack={lab ? () => setLabId(null) : undefined} />
      <main className="flex-1 overflow-auto">
        {Lab ? <Lab /> : <LabHome onOpen={setLabId} />}
      </main>
    </div>
  )
}
