'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { ResearchFact } from '../data/evaluation-validators'
import { safeSourceHref, type AssessmentView, type ResearchView } from '../lib/assessment-view'

const variants: Record<string, StatusBadgeVariant> = { completed: 'success', done: 'success', complete: 'success', ok: 'success', partial: 'warning', failed: 'error', error: 'error', rejected: 'error', unavailable: 'warning', running: 'info', waiting: 'neutral', pending: 'neutral', unknown: 'neutral', empty: 'neutral', blocked: 'warning', timeout: 'warning' }

function StateBadge({ status }: { status: string }) {
  const t = useT()
  return <StatusBadge variant={variants[status] ?? 'neutral'} dot>{t(`photographers.assessment.status.${status}`)}</StatusBadge>
}

function Section({ name, children }: { name: string; children: React.ReactNode }) {
  const t = useT()
  return <section className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4" aria-label={t(`photographers.assessment.${name}`)}>
    <SectionHeader title={t(`photographers.assessment.${name}`)} />{children}
  </section>
}

function Source({ value }: { value: string }) {
  const href = safeSourceHref(value)
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline">{value}</a> : <span className="break-words">{value}</span>
}

function Missing({ status }: { status: string }) {
  const t = useT()
  return status === 'invalid' || status === 'unavailable'
    ? <ErrorMessage label={t(`photographers.assessment.material.${status}`)} />
    : <p className="text-sm text-muted-foreground">{t(`photographers.assessment.material.${status}`)}</p>
}

function FactValue({ fact }: { fact: ResearchFact }) {
  const t = useT()
  if (fact.value === null) return <>{t('photographers.materials.values.unknown')}</>
  if (typeof fact.value === 'boolean') return <>{t(`photographers.materials.values.${fact.value ? 'yes' : 'no'}`)}</>
  if (typeof fact.value === 'number') return <>{fact.value.toLocaleString()}</>
  if (typeof fact.value === 'object') return <>{t('photographers.materials.engagement', { rate: (fact.value.rate * 100).toFixed(1), posts: fact.value.analyzedPostCount })}</>
  if (['businessStartedAt', 'instagramLastPostAt', 'facebookLastPostAt'].includes(fact.key)) return <>{new Date(fact.value).toLocaleString()}</>
  return <>{t(`photographers.materials.values.${fact.value}`)}</>
}

export function ResearchDetails({ research }: { research: ResearchView }) {
  const t = useT()
  return <Section name="research">
    <StateBadge status={research.status} />
    {research.status === 'unavailable' ? <p className="text-sm text-muted-foreground">{t('photographers.assessment.researchUnavailable')}</p> : null}
    {research.status === 'failed' ? <ErrorMessage label={t('photographers.assessment.researchFailed')} /> : null}
    {research.summary ? <p className="whitespace-pre-wrap break-words">{research.summary}</p> : null}
    <dl className="space-y-3">{research.sources.map((source, index) => <div key={`${index}:${source.url}`} className="space-y-1">
      <dt><Source value={source.url} /></dt><dd><StateBadge status={source.status} /></dd>
      {source.summary ? <dd className="whitespace-pre-wrap break-words text-sm">{source.summary}</dd> : null}
    </div>)}</dl>
  </Section>
}

export default function AssessmentDetails({ assessment }: { assessment: AssessmentView }) {
  const t = useT()
  const { registration, owners, process, materials } = assessment
  const traces = materials.traces.status === 'available' ? materials.traces.data : null
  const facts = materials.facts.status === 'available' ? materials.facts.data : null
  const score = materials.score.status === 'available' ? materials.score.data : null
  const showMaterials = assessment.source !== 'demo_fixture'
  return <div className="space-y-6">
    <FormHeader mode="detail" title={`${registration.firstName} ${registration.lastName}`} entityTypeLabel={t('photographers.assessment.title')} statusBadge={<StateBadge status={process.status} />} />
    {assessment.source !== 'real' ? <Alert status="warning"><AlertDescription>{t(`photographers.assessment.source.${assessment.source}`)}</AlertDescription></Alert> : null}
    {process.status === 'failed' ? <ErrorMessage label={t('photographers.assessment.processFailed')} /> : null}
    <div className="grid gap-4 lg:grid-cols-2">
      <Section name="registration">
        <dl className="space-y-3 text-sm">
          <div><dt className="text-muted-foreground">{t('photographers.simulator.email')}</dt><dd className="break-words">{registration.email}</dd></div>
          <div><dt className="text-muted-foreground">{t('photographers.simulator.portfolio')}</dt><dd className="whitespace-pre-wrap break-words">{registration.portfolioRaw || t('photographers.materials.values.unknown')}</dd></div>
          <div><dt className="text-muted-foreground">{t('photographers.assessment.submittedAt')}</dt><dd>{new Date(registration.submittedAt).toLocaleString()}</dd></div>
          <div><dt className="text-muted-foreground">{t('photographers.simulator.registrationId')}</dt><dd className="break-all">{registration.id}</dd></div>
          <div><dt className="text-muted-foreground">{t('photographers.assessment.evaluationId')}</dt><dd className="break-all">{assessment.evaluationId}</dd></div>
        </dl>
        {owners ? <div className="flex flex-wrap gap-4 text-sm">
          <Link href={`/backend/customers/people/${owners.photographerId}`} className="text-primary underline">{t('photographers.simulator.openPerson')}</Link>
          <Link href={`/backend/customers/deals/${owners.dealId}`} className="text-primary underline">{t('photographers.simulator.openDeal')}</Link>
        </div> : <p className="text-sm text-muted-foreground">{t('photographers.assessment.noCrm')}</p>}
      </Section>
      <Section name="progress">
        <StateBadge status={process.status} />
        <p className="break-words text-sm">{t('photographers.assessment.currentStep')}: {process.currentStepId ? t(`photographers.assessment.steps.${process.currentStepId}`, process.currentStepId) : t('photographers.assessment.noStep')}</p>
        {assessment.stages.length ? <dl className="space-y-3">{assessment.stages.map((stage, index) => <div key={`${stage.stepId}:${index}`} className="flex flex-wrap items-center justify-between gap-2">
          <dt className="break-words text-sm">{t(`photographers.assessment.steps.${stage.stepId}`, stage.stepId)}</dt><dd><StateBadge status={stage.status} /></dd>
        </div>)}</dl> : <p className="text-sm text-muted-foreground">{t('photographers.assessment.noStages')}</p>}
      </Section>
    </div>
    {showMaterials ? <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section name="discovery">
          {traces ? <>
            <StateBadge status={traces.discoveryStatus} />
            {!traces.traces.length ? <p className="text-sm text-muted-foreground">{t('photographers.assessment.noSources')}</p> : null}
            <dl className="space-y-4">{traces.traces.map((trace) => <div key={trace.id} className="space-y-1">
              <dt className="text-sm font-medium">{t(`photographers.assessment.trace.${trace.kind}`)}</dt>
              <dd><Source value={trace.value} /></dd>
              {trace.provenance.map((source, index) => <dd key={index} className="space-y-1 text-sm text-muted-foreground"><p className="break-words">{source.value}</p><Source value={source.sourceRef} /><p>{new Date(source.observedAt).toLocaleString()}</p></dd>)}
            </div>)}</dl>
          </> : <Missing status={materials.traces.status} />}
        </Section>
        <ResearchDetails research={assessment.researchView} />
      </div>
      <Section name="facts">
        {facts ? <dl className="grid gap-4 md:grid-cols-2">{facts.facts.map((fact) => <div key={fact.key} className="min-w-0 space-y-1">
          <dt className="text-sm font-medium">{t(`photographers.materials.facts.${fact.key}`)}</dt>
          <dd className="break-words"><FactValue fact={fact} /></dd>
          <dd><StateBadge status={fact.readStatus} /></dd>
          <dd className="text-sm text-muted-foreground"><Source value={fact.sourceRef} /></dd>
          <dd className="text-sm text-muted-foreground">{new Date(fact.observedAt).toLocaleString()}</dd>
          {fact.reason ? <dd className="break-words text-sm text-muted-foreground">{fact.reason}</dd> : null}
        </div>)}</dl> : <Missing status={materials.facts.status} />}
        {facts?.facts.length === 0 ? <p className="text-sm text-muted-foreground">{t('photographers.assessment.noFacts')}</p> : null}
      </Section>
      <Section name="score">
        {score ? <>
          <p className="text-2xl font-semibold">{t('photographers.evaluation_review.score', { score: score.score })}</p>
          <p>{t('photographers.materials.facts.category')}: {t(`photographers.materials.values.${score.category}`)}</p>
          <p className="text-sm text-muted-foreground">{t('photographers.assessment.rulesVersion')}: {score.rulesVersion}</p>
          <dl className="space-y-3">{score.matchedRules.map((rule) => <div key={rule.ruleId}>
            <dt className="text-sm font-medium">{t(`photographers.evaluation_review.rules.${rule.ruleId}`, rule.ruleId)} — {t('photographers.evaluation_review.points', { points: rule.points })}</dt>
            <dd className="text-sm text-muted-foreground"><Source value={rule.sourceRef} /></dd>
          </div>)}</dl>
          {!score.matchedRules.length ? <p>{t('photographers.evaluation_review.no_points')}</p> : null}
          <SectionHeader title={t('photographers.evaluation_review.unknown')} />
          <p className="text-sm text-muted-foreground">{score.unknownFactKeys.length ? score.unknownFactKeys.map((key) => t(`photographers.materials.facts.${key}`)).join(', ') : t('photographers.assessment.noMissingFacts')}</p>
          {score.flags.length ? <Alert status="warning"><AlertDescription>{score.flags.map((flag) => t(`photographers.evaluation_review.flags.${flag}`)).join(', ')}</AlertDescription></Alert> : null}
        </> : <Missing status={materials.score.status} />}
      </Section>
    </> : null}
  </div>
}
