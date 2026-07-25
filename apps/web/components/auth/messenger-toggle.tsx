'use client'

import { MessageCircle, Phone, Send } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const messengers = [
  { value: 'telegram', label: 'Telegram', icon: Send },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { value: 'viber', label: 'Viber', icon: Phone },
]

export function MessengerToggle({
  value,
  onValueChange,
}: {
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v)}
      variant="outline"
      className="w-full"
    >
      {messengers.map((m) => (
        <ToggleGroupItem key={m.value} value={m.value} className="flex-1 gap-2">
          <m.icon className="size-4" />
          {m.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
