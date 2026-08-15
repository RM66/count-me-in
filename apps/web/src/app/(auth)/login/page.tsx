'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { AuthShell } from '@/app/(auth)/_components/auth-shell'
import { TelegramLoginButton } from '@/components/telegram-login-button'

export default function LoginPage() {
  const router = useRouter()
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

  return (
    <AuthShell
      title="Welcome back"
      description="Log in with your Telegram account."
      footer={
        <>
          New to CountMeIn?{' '}
          <Link href="/signup" className="font-medium text-foreground hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {botUsername ? (
        <div className="flex flex-col items-center gap-4">
          <TelegramLoginButton
            botUsername={botUsername}
            buttonSize="large"
            redirectTo="/cabinet"
            onSignupRequired={(ticket) => {
              toast.error('No account found. Please create an account first.')
              router.push(`/signup?ticket=${ticket}`)
            }}
          />
          <p className="text-center text-sm text-muted-foreground">
            Use the same Telegram account you signed up with.
          </p>
        </div>
      ) : (
        <p className="text-center text-sm text-destructive">
          Telegram login is not configured. Please contact support.
        </p>
      )}
    </AuthShell>
  )
}
