'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { AuthShell } from '@/app/(auth)/_components/auth-shell'
import { SIGNUP_TICKET_KEY } from '@/app/(auth)/signup/_components/use-signup-form'
import { TelegramLoginButton } from '@/components/telegram-login-button'
import { isTelegramClientId } from '@/components/telegram-oidc'

export default function LoginPage() {
  const router = useRouter()
  const t = useTranslations('Auth.login')
  const clientId = process.env.NEXT_PUBLIC_TELEGRAM_CLIENT_ID

  return (
    <AuthShell
      title={t('welcomeBack')}
      description={t('description')}
      footer={
        <>
          {t('newHere')}{' '}
          <Link href="/signup" className="font-medium text-foreground hover:underline">
            {t('createAccount')}
          </Link>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <TelegramLoginButton
          clientId={clientId ?? ''}
          redirectTo="/cabinet"
          onSignupRequired={(ticket) => {
            toast.error(t('noAccountFound'))
            // sessionStorage, not ?ticket=: a one-time credential must
            // not land in history, logs or Referer headers.
            sessionStorage.setItem(SIGNUP_TICKET_KEY, ticket)
            router.push('/signup')
          }}
          onError={() => toast.error(t('signInFailed'))}
        />
        {isTelegramClientId(clientId ?? '') && (
          <p className="text-center text-sm text-muted-foreground">{t('sameAccount')}</p>
        )}
      </div>
    </AuthShell>
  )
}
