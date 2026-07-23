'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { services } from '@/lib/mock-data'

export function AddSlotDialog() {
  const [open, setOpen] = useState(false)

  function onCreate() {
    toast.success('Slot added', {
      description: 'This is a design mockup — no data was saved.',
    })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon data-icon="inline-start" />
          Add slot
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add time slot</DialogTitle>
          <DialogDescription>
            Schedule a new session. Defaults come from the service.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="slot-service">Service</FieldLabel>
            <Select defaultValue={services[0]?.id}>
              <SelectTrigger id="slot-service">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {services.map((svc) => (
                    <SelectItem key={svc.id} value={svc.id}>
                      {svc.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="slot-date">Date</FieldLabel>
              <Input id="slot-date" type="date" defaultValue="2026-07-25" />
            </Field>
            <Field>
              <FieldLabel htmlFor="slot-time">Start time</FieldLabel>
              <Input id="slot-time" type="time" defaultValue="07:00" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field>
              <FieldLabel htmlFor="slot-duration">Duration</FieldLabel>
              <Input id="slot-duration" type="number" defaultValue={60} />
            </Field>
            <Field>
              <FieldLabel htmlFor="slot-capacity">Capacity</FieldLabel>
              <Input id="slot-capacity" type="number" defaultValue={12} />
            </Field>
            <Field>
              <FieldLabel htmlFor="slot-price">Price</FieldLabel>
              <Input id="slot-price" placeholder="1200 RSD" />
            </Field>
          </div>
          <Field>
            <FieldDescription>
              Leave price empty to use the service default.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={onCreate}>Add slot</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
