/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { IconButton } from "./icon-button"

function Icon() {
  return <svg aria-hidden data-testid="icon" />
}

describe("IconButton accessible name", () => {
  it("names the button after a plain-string tooltip", () => {
    render(<IconButton tooltip="Refresh"><Icon /></IconButton>)

    // Without this the only thing in the button is an aria-hidden glyph, so screen
    // readers announce a bare "button" — the state most callers shipped by accident.
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument()
  })

  it("keeps an explicit aria-label over the tooltip", () => {
    render(<IconButton tooltip="Shut Down Simulator" aria-label="Shut down"><Icon /></IconButton>)

    expect(screen.getByRole("button", { name: "Shut down" })).toBeInTheDocument()
  })

  it("leaves naming to aria-labelledby when the caller points at other text", () => {
    render(
      <>
        <span id="pin-label">Pin session</span>
        <IconButton tooltip="Pin" aria-labelledby="pin-label"><Icon /></IconButton>
      </>,
    )

    expect(screen.getByRole("button", { name: "Pin session" })).toBeInTheDocument()
  })

  it("adds no name for a rich tooltip, whose flattening would read worse than none", () => {
    render(
      <IconButton tooltip={<span>Undo <kbd>⌘Z</kbd></span>}><Icon /></IconButton>,
    )

    expect(screen.getByRole("button")).not.toHaveAttribute("aria-label")
  })

  it("still renders without a tooltip at all", () => {
    render(<IconButton aria-label="Close"><Icon /></IconButton>)

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
  })
})
