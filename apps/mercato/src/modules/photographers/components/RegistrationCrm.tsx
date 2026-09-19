'use client'

import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'

const crmSchema = z.discriminatedUnion('status', [
  z.object({ registrationId: z.string().uuid(), status: z.literal('pending') }),
  z.object({
    registrationId: z.string().uuid(),
    status: z.literal('ready'),
    photographerId: z.string().uuid(),
    personId: z.string().uuid(),
    dealId: z.string().uuid(),
  }),
])

export default function RegistrationCrm({ registrationId }: { registrationId: string }) {
  const t = useT()
  const [result, setResult] = React.useState<z.infer<typeof crmSchema> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [attempt, setAttempt] = React.useState(0)
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'photographers.registration.crm',
    blockedMessage: t('photographers.simulator.crmFailed'),
  })
  const callbacks = React.useRef({ runMutation, retryLastMutation, t })
  callbacks.current = { runMutation, retryLastMutation, t }

  React.useEffect(() => {
    let active = true
    const endpoint = `/api/photographers/registrations/${registrationId}/crm`
    const { runMutation: mutate, retryLastMutation: retry, t: translate } = callbacks.current
    setError(null)
    async function prepare() {
      try {
        const options = { errorMessage: translate('photographers.simulator.crmFailed') }
        const responseSchema = crmSchema.refine((value) => value.registrationId === registrationId)
        let next = responseSchema.parse(await readApiResultOrThrow(endpoint, { cache: 'no-store' }, options))
        if (!active) return
        if (next.status === 'pending') {
          const mutationPayload = { registrationId }
          next = await mutate({
            operation: async () => {
              z.object({ registrationId: z.string().uuid().refine((value) => value === registrationId) }).parse(mutationPayload)
              return responseSchema.parse(await readApiResultOrThrow(endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
              }, options))
            },
            context: { resourceKind: 'photographers:registration', resourceId: registrationId, retryLastMutation: retry },
            mutationPayload,
          })
        }
        if (active) {
          if (next.status === 'pending') setError(translate('photographers.simulator.crmFailed'))
          else setResult(next)
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error && !(caught instanceof z.ZodError) ? caught.message : translate('photographers.simulator.crmFailed'))
      }
    }
    void prepare()
    return () => { active = false }
  }, [registrationId, attempt])

  return <div className="space-y-4" aria-live="polite">
    {error ? <>
      <ErrorMessage label={error} />
      <p className="text-sm text-muted-foreground">{t('photographers.simulator.crmRetryHint')}</p>
      <Button type="button" onClick={() => setAttempt((current) => current + 1)}>{t('photographers.simulator.crmRetry')}</Button>
    </> : result?.status === 'ready' ? <>
      <Alert status="information">
        <AlertTitle>{t('photographers.simulator.crmReady')}</AlertTitle>
        <AlertDescription>{t('photographers.simulator.crmReadyDescription')}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-4">
        <Button type="button" asChild><Link href={`/backend/customers/people/${result.photographerId}`}>{t('photographers.simulator.openPerson')}</Link></Button>
        <Button type="button" variant="outline" asChild><Link href={`/backend/customers/deals/${result.dealId}`}>{t('photographers.simulator.openDeal')}</Link></Button>
      </div>
    </> : <LoadingMessage label={t('photographers.simulator.crmLoading')} />}
  </div>
}
