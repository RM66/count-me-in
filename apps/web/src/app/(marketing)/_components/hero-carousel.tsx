'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Slide = {
  src: string
  alt: string
  title: string
  meta: string
}

const INTERVAL_MS = 3000

export function HeroCarousel() {
  const t = useTranslations('Marketing.carousel')

  // The slide copy lives in the dictionaries; only the image path is fixed.
  const slides: Slide[] = (t.raw('slides') as Array<{ alt: string; title: string; meta: string }>).map(
    (slide, index) => ({
      ...slide,
      src: [
        '/service-yoga.png',
        '/service-hiking.png',
        '/service-workshop.png',
        '/service-tour.png',
        '/service-breathwork.png',
      ][index] as string,
    }),
  )

  // `active` starts at 0 so the server and the first client render agree; the
  // random slide is picked only after mount, when the images are rendered.
  const [active, setActive] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [paused, setPaused] = useState(false)
  const reducedMotion = useRef(false)

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setMounted(true)
    setActive(Math.floor(slides.length * Math.random()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goTo = useCallback((index: number) => {
    setActive((index + slides.length) % slides.length)
  }, [slides.length])

  useEffect(() => {
    if (paused || reducedMotion.current) return
    const id = window.setInterval(() => {
      setActive((current) => (current + 1) % slides.length)
    }, INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [paused, slides.length])

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
        aria-label={t('ariaLabel')}
      >
        {mounted ? (
          slides.map((slide, index) => (
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
          ))
        ) : (
          <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden />
        )}
      </div>

      {/* Caption card, in sync with the active slide. */}
      <div
        className="absolute -bottom-5 -left-5 hidden rounded-xl border bg-card p-4 shadow-md sm:block"
        aria-live="polite"
      >
        {mounted ? (
          <>
            <p className="text-sm font-medium">{current?.title}</p>
            <p className="text-sm text-muted-foreground">{current?.meta}</p>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        )}
      </div>

      {/* Dot controls. */}
      <div className="absolute right-4 bottom-4 flex items-center gap-2">
        {slides.map((slide, index) => (
          <button
            key={slide.src}
            type="button"
            onClick={() => goTo(index)}
            aria-label={t('showSlide', { title: slide.title })}
            aria-current={index === active}
            className={cn(
              'size-2.5 rounded-full border border-black/10 transition-all',
              index === active ? 'w-5 bg-background' : 'bg-background/60 hover:bg-background/90',
            )}
          />
        ))}
      </div>
    </div>
  )
}
