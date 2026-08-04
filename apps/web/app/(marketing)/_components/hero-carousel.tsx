'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

type Slide = {
  src: string
  alt: string
  title: string
  meta: string
}

// Each slide pairs a themed photo with a caption that matches it, so the
// floating card never claims a yoga class while showing a hiking group.
const slides: Slide[] = [
  {
    src: '/service-yoga.png',
    alt: 'A morning yoga class in a bright studio',
    title: 'Morning Vinyasa Flow',
    meta: 'Tomorrow · 07:00 · 3 seats left',
  },
  {
    src: '/service-fitness.png',
    alt: 'A group fitness class training with light dumbbells',
    title: 'HIIT Bootcamp',
    meta: 'Thu · 18:30 · 5 seats left',
  },
  {
    src: '/service-hiking.png',
    alt: 'A small group hiking on a mountain trail',
    title: 'Sunrise Ridge Hike',
    meta: 'Sat · 06:00 · 8 seats left',
  },
  {
    src: '/service-workshop.png',
    alt: 'A hands-on creative workshop around a shared table',
    title: 'Pottery Workshop',
    meta: 'Sun · 14:00 · 2 seats left',
  },
  {
    src: '/service-tour.png',
    alt: 'A guided walking tour through an old-town street',
    title: 'Old Town Walking Tour',
    meta: 'Fri · 11:00 · 12 seats left',
  },
]

const INTERVAL_MS = 4500

export function HeroCarousel() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const reducedMotion = useRef(false)

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const goTo = useCallback((index: number) => {
    setActive((index + slides.length) % slides.length)
  }, [])

  useEffect(() => {
    if (paused || reducedMotion.current) return
    const id = window.setInterval(() => {
      setActive((current) => (current + 1) % slides.length)
    }, INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [paused])

  const current = slides[active]

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        className="relative aspect-4/3 overflow-hidden rounded-2xl border shadow-sm"
        aria-roledescription="carousel"
        aria-label="Examples of group services you can publish"
      >
        {slides.map((slide, index) => (
          <Image
            key={slide.src}
            src={slide.src || '/placeholder.svg'}
            alt={slide.alt}
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className={cn(
              'object-cover transition-opacity duration-700 ease-in-out motion-reduce:transition-none',
              index === active ? 'opacity-100' : 'opacity-0',
            )}
            priority={index === 0}
            aria-hidden={index === active ? undefined : true}
          />
        ))}
      </div>

      {/* Caption card, in sync with the active slide. */}
      <div
        className="absolute -bottom-5 -left-5 hidden rounded-xl border bg-card p-4 shadow-md sm:block"
        aria-live="polite"
      >
        <p className="text-sm font-medium">{current.title}</p>
        <p className="text-sm text-muted-foreground">{current.meta}</p>
      </div>

      {/* Dot controls. */}
      <div className="absolute right-4 bottom-4 flex items-center gap-2">
        {slides.map((slide, index) => (
          <button
            key={slide.src}
            type="button"
            onClick={() => goTo(index)}
            aria-label={`Show ${slide.title}`}
            aria-current={index === active}
            className={cn(
              'size-2.5 rounded-full border border-black/10 transition-all',
              index === active
                ? 'w-5 bg-background'
                : 'bg-background/60 hover:bg-background/90',
            )}
          />
        ))}
      </div>
    </div>
  )
}
