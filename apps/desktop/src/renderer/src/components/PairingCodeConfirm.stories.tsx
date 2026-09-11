import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { PairingCodeConfirm } from './PairingCodeConfirm'

const meta: Meta<typeof PairingCodeConfirm> = {
  title: 'Settings/PairingCodeConfirm',
  component: PairingCodeConfirm,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof PairingCodeConfirm>

function Playground(props: {
  deviceName: string
  code: string
  error?: string
  confirming?: boolean
}) {
  const [deviceName, setDeviceName] = useState(props.deviceName)
  const [code, setCode] = useState(props.code)
  return (
    <div className="max-w-md rounded-lg border border-border p-4">
      <PairingCodeConfirm
        deviceName={deviceName}
        onDeviceNameChange={setDeviceName}
        code={code}
        onCodeChange={setCode}
        error={props.error ?? ''}
        confirming={props.confirming ?? false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </div>
  )
}

export const IosDefault: Story = {
  render: () => <Playground deviceName="iPhone" code="" />,
}

export const AndroidDefault: Story = {
  render: () => <Playground deviceName="Google Pixel 8" code="" />,
}

export const EditedName: Story = {
  render: () => <Playground deviceName="Kitchen iPhone" code="123456" />,
}

export const Confirming: Story = {
  render: () => <Playground deviceName="iPhone" code="123456" confirming />,
}

export const ErrorState: Story = {
  render: () => <Playground deviceName="iPhone" code="000000" error="Incorrect code. Please check your phone and try again." />,
}

export const LongName: Story = {
  render: () => (
    <Playground
      deviceName="Hangqi's very long iPhone name that should still fit the field"
      code=""
    />
  ),
}

export const Narrow: Story = {
  render: () => (
    <div className="w-72">
      <Playground deviceName="Google Pixel 8" code="12" />
    </div>
  ),
}
