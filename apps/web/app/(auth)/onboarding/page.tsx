'use client'

import { useRouter } from 'next/navigation'
import { AuthShell } from '@/app/(auth)/_components/auth-shell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'

export default function OnboardingPage() {
  const router = useRouter()

  return (
    <AuthShell
      title="Finish your profile"
      description="Add a photo and a short description before you publish services. You can change these anytime."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          toast.success('Profile saved')
          router.push('/cabinet')
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel>Profile photo</FieldLabel>
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                <AvatarImage src="/organizer-avatar.png" alt="" />
                <AvatarFallback>SL</AvatarFallback>
              </Avatar>
              <Button type="button" variant="outline">
                <Upload data-icon="inline-start" />
                Upload photo
              </Button>
            </div>
            <FieldDescription>JPG or PNG, up to 5 MB.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="description">About you</FieldLabel>
            <Textarea
              id="description"
              rows={5}
              placeholder="Boutique movement studio in the heart of Belgrade. Small-group yoga, breathwork, and pottery…"
              defaultValue="Boutique movement studio in the heart of Belgrade. Small-group yoga, breathwork, and pottery. Come as you are — beginners always welcome."
            />
            <FieldDescription>Markdown supported. Shown on your public page.</FieldDescription>
          </Field>

          <div className="flex flex-col gap-2">
            <Button type="submit" className="w-full">
              Go to my cabinet
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => router.push('/cabinet')}
            >
              Skip for now
            </Button>
          </div>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
