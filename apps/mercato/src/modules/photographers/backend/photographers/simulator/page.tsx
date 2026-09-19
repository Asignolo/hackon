'use client'

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'

export default function RegistrationSimulatorPage() {
  const t = useT()
  const [savedId, setSavedId] = React.useState<string | null>(null)
  const schema = React.useMemo(() => z.object({
    firstName: z.string().min(1, t('photographers.simulator.required')).max(200).refine((value) => value.trim().length > 0, t('photographers.simulator.required')),
    lastName: z.string().min(1, t('photographers.simulator.required')).max(200).refine((value) => value.trim().length > 0, t('photographers.simulator.required')),
    email: z.string().email(t('photographers.simulator.emailInvalid')).max(320),
    portfolioRaw: z.string().max(2048, t('photographers.simulator.portfolioTooLong')).refine((value) => value.trim().length > 0, t('photographers.simulator.required')),
  }), [t])
  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'firstName', type: 'text', label: t('photographers.simulator.firstName'), required: true },
    { id: 'lastName', type: 'text', label: t('photographers.simulator.lastName'), required: true },
    { id: 'email', type: 'text', label: t('photographers.simulator.email'), required: true },
    { id: 'portfolioRaw', type: 'textarea', required: true, label: t('photographers.simulator.portfolio'), description: t('photographers.simulator.portfolioHint') },
  ], [t])

  return (
    <Page>
      <PageBody>
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <p className="text-sm text-muted-foreground">{t('photographers.simulator.description')}</p>
          {savedId ? (
            <div className="space-y-4">
              <Alert status="success">
                <AlertTitle>{t('photographers.simulator.saved')}</AlertTitle>
                <AlertDescription>
                  <p>{t('photographers.simulator.savedDescription')}</p>
                  <p className="break-all">{t('photographers.simulator.registrationId')}: {savedId}</p>
                </AlertDescription>
              </Alert>
              <Button type="button" onClick={() => setSavedId(null)}>{t('photographers.simulator.next')}</Button>
            </div>
          ) : (
            <CrudForm
              title={t('photographers.simulator.title')}
              titleHeadingLevel={1}
              schema={schema}
              fields={fields}
              initialValues={{ firstName: '', lastName: '', email: '', portfolioRaw: '' }}
              submitLabel={t('photographers.simulator.submit')}
              onSubmit={async (values) => {
                const result = await createCrud<{ id: string }>('photographers/raw-data', values, {
                  errorMessage: t('photographers.simulator.failed'),
                })
                if (result.result?.id) {
                  setSavedId(result.result.id)
                  flash(t('photographers.simulator.saved'), 'success')
                }
              }}
            />
          )}
        </div>
      </PageBody>
    </Page>
  )
}
