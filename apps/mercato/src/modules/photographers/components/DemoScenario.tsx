'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
import { demoExecutionSchema, demoRequestSchema, type DemoExecution } from '../data/demo-api-validators'

const finished = new Set(['completed', 'rejected', 'revoked', 'cancelled'])

export default function DemoScenario() {
  const scopeVersion = useOrganizationScopeVersion()
  return <ScopedDemoScenario key={scopeVersion} />
}

function ScopedDemoScenario() {
  const t = useT()
  const params = useSearchParams()
  const initial = demoRequestSchema.safeParse({ requestId: params?.get('requestId') })
  const [requestId, setRequestId] = React.useState<string | null>(initial.success ? initial.data.requestId : null)
  const [execution, setExecution] = React.useState<DemoExecution | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [ready, setReady] = React.useState(false)
  const mounted = React.useRef(true)
  const latestRead = React.useRef(0)
  const mutationPending = React.useRef(false)
  const executionStatus = execution?.status
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: 'photographers.demo', blockedMessage: t('photographers.demo.failed') })

  React.useEffect(() => {
    mounted.current = true
    setReady(true)
    return () => { mounted.current = false; latestRead.current += 1 }
  }, [])

  const refresh = React.useCallback(async () => {
    if (!requestId || mutationPending.current) return
    const readId = ++latestRead.current
    try {
      const result = demoExecutionSchema.parse(await readApiResultOrThrow(`/api/photographers/demo-evaluations/${requestId}`, { cache: 'no-store' }, { errorMessage: t('photographers.demo.failed') }))
      if (mounted.current && readId === latestRead.current) { setExecution(result); setError(null) }
    } catch (caught) {
      if (mounted.current && readId === latestRead.current) setError(caught instanceof Error ? caught.message : t('photographers.demo.failed'))
    }
  }, [requestId, t])

  React.useEffect(() => { void refresh() }, [refresh])
  React.useEffect(() => {
    if (!requestId || !executionStatus || finished.has(executionStatus) || executionStatus === 'failed' || executionStatus === 'unavailable') return
    const timer = window.setInterval(() => { void refresh() }, 3000)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [requestId, executionStatus, refresh])

  async function startOrResume(resume: boolean) {
    if (mutationPending.current) return
    mutationPending.current = true
    latestRead.current += 1
    setBusy(true)
    setError(null)
    const id = requestId ?? crypto.randomUUID()
    setRequestId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('requestId', id)
    window.history.replaceState(null, '', url)
    try {
      const result = await runMutation({
        operation: async () => demoExecutionSchema.parse(await readApiResultOrThrow(
          resume ? `/api/photographers/demo-evaluations/${id}` : '/api/photographers/demo-evaluations',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resume ? {} : { requestId: id }) },
          { errorMessage: t('photographers.demo.failed') },
        )),
        context: { resourceKind: 'photographers:demo_execution', resourceId: id, retryLastMutation },
        mutationPayload: { requestId: id },
      })
      if (mounted.current) setExecution(result)
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : t('photographers.demo.failed'))
    } finally {
      mutationPending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const status = execution?.status
  const reviewReady = Boolean(execution?.proposalId)
  const terminal = status ? finished.has(status) : false
  const resolved = status === 'completed' || status === 'rejected' || status === 'revoked'
  const canStartAnother = terminal || status === 'failed' || status === 'unavailable' || Boolean(requestId && error)
  const steps: StepIndicatorStep[] = [
    { id: 'registration', label: t('photographers.demo.steps.registration'), status: execution ? 'complete' : busy ? 'current' : 'pending' },
    { id: 'research', label: t('photographers.demo.steps.research'), status: reviewReady || resolved ? 'complete' : status === 'failed' ? 'error' : execution ? 'current' : 'pending' },
    { id: 'review', label: t('photographers.demo.steps.review'), status: resolved ? 'complete' : reviewReady ? 'current' : 'pending' },
    { id: 'result', label: t('photographers.demo.steps.result'), status: resolved ? 'complete' : 'pending' },
  ]

  return <div className="mx-auto max-w-3xl space-y-6">
    <FormHeader mode="detail" title={t('photographers.demo.title')} subtitle={t('photographers.demo.description')} />
    <Alert status="information"><AlertTitle>{t('photographers.demo.synthetic')}</AlertTitle><AlertDescription>{t('photographers.demo.no_delivery')}</AlertDescription></Alert>
    <StepIndicator steps={steps} orientation="vertical" />
    {error ? <ErrorMessage label={error} /> : null}
    {busy || (requestId && !execution && !error) ? <LoadingMessage label={t('photographers.demo.loading')} /> : null}
    {status ? <Alert status={status === 'failed' || status === 'unavailable' ? 'error' : status === 'completed' || status === 'rejected' ? 'success' : 'information'}>
      <AlertTitle>{t(`photographers.demo.status.${status}`)}</AlertTitle>
      <AlertDescription>{t(`photographers.demo.hint.${status}`)}</AlertDescription>
    </Alert> : null}
    <div className="flex flex-wrap gap-3">
      {!execution ? <Button type="button" disabled={busy || !ready} onClick={() => void startOrResume(false)}>{t(requestId ? 'photographers.demo.retry_start' : 'photographers.demo.start')}</Button> : null}
      {execution?.links.proposal ? <Button type="button" asChild><Link href={execution.links.proposal}>{t('photographers.demo.open_review')}</Link></Button> : null}
      {execution ? <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>{t('photographers.demo.refresh')}</Button> : null}
      {execution && !terminal ? <Button type="button" variant="outline" disabled={busy} onClick={() => void startOrResume(true)}>{t('photographers.demo.resume')}</Button> : null}
      {canStartAnother ? <Button type="button" variant="outline" asChild><Link href="/backend/photographers/demo" onClick={() => { latestRead.current += 1; setRequestId(null); setExecution(null); setError(null) }}>{t('photographers.demo.another')}</Link></Button> : null}
    </div>
    {execution ? <div className="flex flex-wrap gap-4 text-sm">
      {(['person', 'deal', 'execution', 'workflow'] as const).map((kind) => execution.links[kind] ? <Link key={kind} href={execution.links[kind]!} className="underline underline-offset-4">{t(`photographers.demo.links.${kind}`)}</Link> : null)}
    </div> : null}
  </div>
}
