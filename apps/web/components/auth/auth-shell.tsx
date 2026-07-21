import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-6 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <Image src="/logo.svg" alt="" width={32} height={32} className="size-8" />
        <span className="text-xl font-semibold tracking-tight">CountMeIn</span>
      </Link>
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col gap-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground text-pretty">{description}</p>
        </div>
        {children}
      </div>
      {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  )
}
