import Link from 'next/link'
import Image from 'next/image'

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Image src="/logo.svg" alt="" width={24} height={24} className="size-6" />
          <span className="font-semibold">CountMeIn</span>
          <span className="text-sm text-muted-foreground">— online booking for group events</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/login" className="hover:text-foreground">
            Log in
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
        </nav>
        <p className="text-sm text-muted-foreground">© 2026 CountMeIn</p>
      </div>
    </footer>
  )
}
