'use client'

import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { personAssessmentResponseSchema } from '../../../data/person-assessment-validators'

const contextSchema = z.object({ personId: z.string().uuid() })
type LookupState =
  | { status: 'loading' | 'failed' | 'forbidden' | 'empty' }
  | { status: 'ready'; evaluationId: string; registrationId: string }

export default function PersonAssessmentWidget({ context }: InjectionWidgetComponentProps) {
  const scopeVersion = useOrganizationScopeVersion()
  const parsed = contextSchema.safeParse(context)
  return parsed.success ? <PersonAssessment key={`${parsed.data.personId}:${scopeVersion}`} personId={parsed.data.personId} /> : null
}

function PersonAssessment({ personId }: { personId: string }) {
  const t = useT()
  const [revision, setRevision] = React.useState(0)
  const [state, setState] = React.useState<LookupState>({ status: 'loading' })
  React.useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void apiCall<unknown>(`/api/photographers/people/${encodeURIComponent(personId)}/assessment`, { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        if (!response.ok) {
          setState({ status: response.status === 403 || response.status === 401 ? 'forbidden' : 'failed' })
          return
        }
        const { assessment } = personAssessmentResponseSchema.parse(response.result)
        setState(assessment ? { status: 'ready', ...assessment } : { status: 'empty' })
      })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'failed' }) })
    return () => controller.abort()
  }, [personId, revision])

  return <section className="space-y-2" aria-label={t('photographers.assessment.title')}>
    {state.status === 'loading' ? <LoadingMessage label={t('photographers.materials.loading')} /> : null}
    {state.status === 'failed' || state.status === 'forbidden' ? <ErrorMessage label={t(`photographers.assessment.load.${state.status}`)} /> : null}
    {state.status === 'empty' ? <p className="text-sm text-muted-foreground">{t('photographers.assessment.noAssessment')}</p> : null}
    {state.status === 'ready' ? <Button asChild variant="outline"><Link href={`/backend/photographers/assessment?evaluationId=${state.evaluationId}&registrationId=${state.registrationId}`}>{t('photographers.assessment.openLatest')}</Link></Button> : null}
    {state.status === 'failed' || state.status === 'empty' ? <Button type="button" variant="outline" onClick={() => setRevision((value) => value + 1)}>{t('photographers.materials.refresh')}</Button> : null}
  </section>
}
