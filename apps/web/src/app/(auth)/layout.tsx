import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-6 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <Image src="/logo.svg" alt="" width={32} height={32} className="size-8" />
        <span className="text-xl font-semibold tracking-tight">CountMeIn</span>
      </Link>
      {children}
    </div>
  )
}
