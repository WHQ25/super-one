import { Button } from "@superone/ui/components/ui/button"

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-4xl font-semibold tracking-tight">SuperOne</h1>
        <p className="text-muted-foreground">Coming soon</p>
        <div className="flex gap-3">
          <Button>Get started</Button>
          <Button variant="outline">Learn more</Button>
        </div>
      </div>
    </main>
  )
}
