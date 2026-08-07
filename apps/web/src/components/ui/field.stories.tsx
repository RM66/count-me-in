import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const meta = {
  title: 'UI/Field',
  component: Field,
  tags: ['autodocs'],
} satisfies Meta<typeof Field>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="w-96">
      <Field>
        <FieldLabel htmlFor="service">Service name</FieldLabel>
        <Input id="service" placeholder="Yoga class" />
        <FieldDescription>Shown on your public booking page.</FieldDescription>
      </Field>
    </div>
  ),
}

export const FormExample: Story = {
  render: () => (
    <div className="w-96">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input id="name" placeholder="Yoga class" />
        </Field>
        <Field>
          <FieldLabel htmlFor="about">Description</FieldLabel>
          <Textarea id="about" placeholder="Tell guests what to expect" />
          <FieldDescription>Optional, up to 500 characters.</FieldDescription>
        </Field>
        <FieldSeparator>Booking options</FieldSeparator>
        <FieldSet>
          <FieldLegend variant="label">Notifications</FieldLegend>
          <Field orientation="horizontal">
            <Checkbox id="notify-telegram" defaultChecked />
            <FieldContent>
              <FieldTitle>Telegram</FieldTitle>
              <FieldDescription>Get a message for every new booking.</FieldDescription>
            </FieldContent>
          </Field>
        </FieldSet>
      </FieldGroup>
    </div>
  ),
}

export const WithError: Story = {
  render: () => (
    <div className="w-96">
      <Field data-invalid="true">
        <FieldLabel htmlFor="capacity">Capacity</FieldLabel>
        <Input id="capacity" type="number" defaultValue={-1} aria-invalid />
        <FieldError errors={[{ message: 'Capacity must be at least 1.' }]} />
      </Field>
    </div>
  ),
}
