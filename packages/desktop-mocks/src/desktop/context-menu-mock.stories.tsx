import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  AUTOMATION_ROW_CONTEXT_MENU,
  ContextMenuMock,
  FILE_QUOTE_CONTEXT_MENU,
  FILE_ROW_CONTEXT_MENU,
  FOLDER_ROW_CONTEXT_MENU,
  IMAGE_CONTEXT_MENU,
  PROJECT_ROW_CONTEXT_MENU,
  SESSION_ROW_CONTEXT_MENU,
  TEXT_SELECTION_CONTEXT_MENU,
} from "./context-menu-mock"

const meta: Meta<typeof ContextMenuMock> = {
  title: "Desktop Mocks/ContextMenus",
  component: ContextMenuMock,
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof ContextMenuMock>

export const FileRow: Story = {
  args: { items: FILE_ROW_CONTEXT_MENU, width: 200 },
}

export const FolderRow: Story = {
  args: { items: FOLDER_ROW_CONTEXT_MENU, width: 200 },
}

export const ProjectRow: Story = {
  args: { items: PROJECT_ROW_CONTEXT_MENU, width: 192 },
}

export const SessionRow: Story = {
  args: { items: SESSION_ROW_CONTEXT_MENU, width: 220 },
}

export const AutomationRow: Story = {
  args: { items: AUTOMATION_ROW_CONTEXT_MENU, width: 184 },
}

export const TextSelection: Story = {
  args: { items: TEXT_SELECTION_CONTEXT_MENU, width: 176 },
}

export const FileQuote: Story = {
  args: { items: FILE_QUOTE_CONTEXT_MENU, width: 240 },
}

export const Image: Story = {
  args: { items: IMAGE_CONTEXT_MENU, width: 208 },
}
