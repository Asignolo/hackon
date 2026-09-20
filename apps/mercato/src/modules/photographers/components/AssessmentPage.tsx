'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { loadAssessment, type AssessmentLoadResult } from '../lib/assessment-view'
import AssessmentDetails from './AssessmentDetails'

export default function AssessmentPage() {
  const params = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const evaluationId = params.get('evaluationId') ?? ''
  const registrationId = params.get('registrationId') ?? ''
  return <AssessmentLoader key={`${scopeVersion}:${evaluationId}:${registrationId}`} evaluationId={evaluationId} registrationId={registrationId} />
}

function AssessmentLoader({ evaluationId, registrationId }: { evaluationId: string; registrationId: string }) {
  const t = useT()
  const [result, setResult] = React.useState<AssessmentLoadResult | null>(null)
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    setResult(null)
    void loadAssessment({ evaluationId, registrationId }, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setResult(next) })
      .catch(() => { if (!controller.signal.aborted) setResult({ state: 'failed' }) })
    return () => controller.abort()
  }, [evaluationId, registrationId, revision])
  return <div className="space-y-4" aria-live="polite">
    <div className="flex justify-end"><Button type="button" variant="outline" onClick={() => setRevision((value) => value + 1)} disabled={!result}>{t('photographers.materials.refresh')}</Button></div>
    {!result ? <LoadingMessage label={t('photographers.materials.loading')} />
      : result.state === 'ready' ? <AssessmentDetails assessment={result.data} />
        : result.state === 'notFound' ? <RecordNotFoundState label={t('photographers.assessment.notFound')} />
          : <ErrorMessage label={t(`photographers.assessment.load.${result.state}`)} />}
  </div>
}
