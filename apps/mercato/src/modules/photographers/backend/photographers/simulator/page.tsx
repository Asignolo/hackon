'use client'

import * as React from 'react'
import { z } from 'zod'
import { useSearchParams } from 'next/navigation'
import { getCurrentOrganizationScope, subscribeOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import RegistrationCrm from '../../../components/RegistrationCrm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'

function setRegistrationUrl(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('registrationId', id)
  else url.searchParams.delete('registrationId')
  window.history.replaceState(null, '', url)
}

export default function RegistrationSimulatorPage() {
  const [scopeVersion, setScopeVersion] = React.useState(0)
  const previousScope = React.useRef(getCurrentOrganizationScope())
  const initialized = React.useRef(Boolean(previousScope.current.tenantId || previousScope.current.organizationId))
  React.useEffect(() => subscribeOrganizationScopeChanged((scope) => {
    const previous = previousScope.current
    previousScope.current = scope
    if (initialized.current && (previous.tenantId !== scope.tenantId || previous.organizationId !== scope.organizationId)) {
      setRegistrationUrl(null)
      setScopeVersion((version) => version + 1)
    }
    initialized.current = true
  }), [])
  return <ScopedRegistrationSimulator key={scopeVersion} recoverFromUrl={scopeVersion === 0} />
}

function ScopedRegistrationSimulator({ recoverFromUrl }: { recoverFromUrl: boolean }) {
  const t = useT()
  const params = useSearchParams()
  const initialId = z.string().uuid().safeParse(params?.get('registrationId'))
  const [savedId, setSavedId] = React.useState<string | null>(recoverFromUrl && initialId.success ? initialId.data : null)
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
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
              <RegistrationCrm key={savedId} registrationId={savedId} />
              <Button type="button" variant="outline" onClick={() => { setRegistrationUrl(null); setSavedId(null) }}>{t('photographers.simulator.next')}</Button>
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
                if (mounted.current && result.result?.id) {
                  setRegistrationUrl(result.result.id)
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
