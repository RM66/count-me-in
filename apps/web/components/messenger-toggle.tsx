'use client'

import { MessageCircle, Phone, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fadeLeft, setFadeLeft] = useState(false)
  const [fadeRight, setFadeRight] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const update = () => {
      setFadeLeft(el.scrollLeft > 0)
      setFadeRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)

    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  const maskImage = [
    `linear-gradient(to right,`,
    fadeLeft ? 'transparent,' : 'black,',
    `black 1rem, black calc(100% - 1rem),`,
    fadeRight ? 'transparent)' : 'black)',
  ].join(' ')

  return (
    <div
      ref={scrollRef}
      className="w-full overflow-x-auto"
      style={{ maskImage, WebkitMaskImage: maskImage }}
    >
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onValueChange(v)}
        variant="outline"
        className="w-full"
      >
        {messengers.map((m) => (
          <ToggleGroupItem
            key={m.value}
            value={m.value}
            className="flex-1 shrink-0 basis-[content] gap-2"
          >
            <m.icon className="size-4" />
            {m.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
