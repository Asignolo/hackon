"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { proposalReviewMaterialsResponseSchema, type ProposalReviewMaterialsResponse } from '../../../data/proposal-review-validators'
import type { ResearchFact } from '../../../data/evaluation-validators'

function proposalFromContext(context: unknown): string | null {
  if (!context || typeof context !== 'object' || !('path' in context) || typeof context.path !== 'string') return null
  return /^\/backend\/caseload\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(context.path)?.[1]?.toLowerCase() ?? null
}

export default function ProposalMaterialsWidget({ context }: InjectionWidgetComponentProps) {
  const scopeVersion = useOrganizationScopeVersion()
  const proposalId = proposalFromContext(context)
  return proposalId ? <ProposalMaterials key={`${proposalId}:${scopeVersion}`} proposalId={proposalId} /> : null
}

function ProposalMaterials({ proposalId }: { proposalId: string }) {
  const t = useT()
  const [revision, setRevision] = React.useState(0)
  const [result, setResult] = React.useState<ProposalReviewMaterialsResponse | null>(null)
  const [failed, setFailed] = React.useState(false)
  useAppEvent('agent_orchestrator.proposal.*', (event) => {
    if (event.payload.id === proposalId || event.payload.proposalId === proposalId) setRevision((value) => value + 1)
  }, [proposalId])

  React.useEffect(() => {
    let active = true
    setResult(null)
    setFailed(false)
    void readApiResultOrThrow<unknown>(`/api/photographers/proposals/${encodeURIComponent(proposalId)}/materials`, { cache: 'no-store' })
      .then((raw) => {
        const parsed = proposalReviewMaterialsResponseSchema.parse(raw)
        if (parsed.proposalId !== proposalId) throw new Error('[internal] Proposal material response mismatch')
        if (active) setResult(parsed)
      })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [proposalId, revision])

  if (result?.options.length === 0) return null
  return <section className="mx-4 mt-4 space-y-4 rounded-lg border border-border bg-card p-4" aria-label={t('photographers.materials.title')}>
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-lg font-semibold">{t('photographers.materials.title')}</h2>
      <Button type="button" variant="outline" onClick={() => setRevision((value) => value + 1)}>{t('photographers.materials.refresh')}</Button>
    </div>
    {failed ? <ErrorMessage label={t('photographers.materials.unavailable')} /> : !result ? <LoadingMessage label={t('photographers.materials.loading')} /> : <>
      <p className="text-sm text-muted-foreground">{t('photographers.materials.instructions')}</p>
      {result.options.map((option) => <section key={option.selectedOptionId} className="space-y-3">
        <h3 className="font-medium">{option.label}</h3>
        {option.materials.map((material) => <React.Fragment key={material.id}>
          {material.kind === 'message' ? <div className="space-y-2">
            <h4 className="text-sm font-medium">{t('photographers.materials.message')}</h4>
            <p className="whitespace-pre-wrap break-words rounded-md border border-border p-4">{material.data.body}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{material.data.internalRationale}</p>
          </div> : material.kind === 'facts' ? <dl className="space-y-3">
            {material.data.facts.map((fact) => <div key={fact.key} className="space-y-1">
              <dt className="text-sm font-medium">{t(`photographers.materials.facts.${fact.key}`)}</dt>
              <dd className="break-words text-sm"><FactValue fact={fact} /></dd>
              <dd className="break-words text-sm text-muted-foreground">{t('photographers.materials.source')}: {fact.sourceRef}</dd>
              {fact.reason ? <dd className="break-words text-sm text-muted-foreground">{fact.reason}</dd> : null}
            </div>)}
          </dl> : null}
        </React.Fragment>)}
      </section>)}
    </>}
  </section>
}

function FactValue({ fact }: { fact: ResearchFact }) {
  const t = useT()
  if (fact.value === null) return <>{t('photographers.materials.values.unknown')}</>
  if (typeof fact.value === 'boolean') return <>{t(`photographers.materials.values.${fact.value ? 'yes' : 'no'}`)}</>
  if (typeof fact.value === 'number') return <>{fact.value.toLocaleString()}</>
  if (typeof fact.value === 'object') return <>{t('photographers.materials.engagement', { rate: (fact.value.rate * 100).toFixed(1), posts: fact.value.analyzedPostCount })}</>
  if (fact.key === 'businessStartedAt' || fact.key === 'instagramLastPostAt' || fact.key === 'facebookLastPostAt') return <>{new Date(fact.value).toLocaleDateString()}</>
  return <>{t(`photographers.materials.values.${fact.value}`)}</>
}
