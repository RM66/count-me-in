import { Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  const t = useTranslations('Ui')

  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={t('loading')}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
