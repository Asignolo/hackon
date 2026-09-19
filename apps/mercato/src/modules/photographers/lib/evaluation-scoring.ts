import {
  factsSnapshotSchema,
  researchFactKeySchema,
  scoreSnapshotSchema,
  type FactsSnapshot,
  type ResearchFact,
  type ScoreSnapshot,
} from '../data/evaluation-validators'
import { hiddenPotentialRulesSchema, type HiddenPotentialRules } from './rules-config'

function secondAnniversary(timestamp: string): number {
  const anniversary = new Date(timestamp)
  const originalMonth = anniversary.getUTCMonth()
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 2)
  if (anniversary.getUTCMonth() !== originalMonth) anniversary.setUTCDate(0)
  return anniversary.getTime()
}

export function calculateEvaluationScore(input: {
  facts: FactsSnapshot
  factsRef: string
  rules: HiddenPotentialRules
}): ScoreSnapshot {
  const facts = factsSnapshotSchema.parse(input.facts)
  const rules = hiddenPotentialRulesSchema.parse(input.rules)
  const evaluatedAt = Date.parse(facts.evaluatedAt)
  const knownFacts = facts.facts.filter((fact) => fact.state === 'known')
  const factsByKey = new Map(knownFacts.map((fact) => [fact.key, fact]))
  const matchedRules: ScoreSnapshot['matchedRules'] = []
  const flags: ScoreSnapshot['flags'] = []
  const recentPost = (timestamp: string) => {
    const age = evaluatedAt - Date.parse(timestamp)
    return age >= 0 && age < rules.thresholds.recentPostDays * 86_400_000
  }
  const match = (fact: ResearchFact): keyof HiddenPotentialRules['weights'] | undefined => {
    switch (fact.key) {
      case 'nipConfirmed': return fact.value === true ? 'nipConfirmed' : undefined
      case 'businessStartedAt': return fact.value !== null && secondAnniversary(fact.value) < evaluatedAt ? 'businessOlderThanTwoYears' : undefined
      case 'vatStatus': return fact.value === 'active' ? 'vatActive' : undefined
      case 'photographicPkd': return fact.value === true ? 'photographicPkd' : undefined
      case 'showsPrint': return fact.value === true ? 'showsPrint' : undefined
      case 'instagramLastPostAt': return fact.value !== null && recentPost(fact.value) ? 'instagramRecentPost' : undefined
      case 'instagramFollowers': return fact.value !== null && fact.value >= rules.thresholds.instagramFollowers ? 'instagramFollowers' : undefined
      case 'instagramEngagement': return fact.value !== null && fact.value.analyzedPostCount === rules.thresholds.engagementPostCount && fact.value.rate >= rules.thresholds.instagramEngagement ? 'instagramEngagement' : undefined
      case 'facebookLastPostAt': return fact.value !== null && recentPost(fact.value) ? 'facebookRecentPost' : undefined
      case 'ownDomain': return fact.value === true ? 'ownDomain' : undefined
      case 'websiteCurrent': return fact.value === true ? 'websiteCurrent' : undefined
      case 'bookingCalendar': return fact.value === true ? 'bookingCalendar' : undefined
      case 'gallerySystem': return fact.value !== null && fact.value !== 'none' && fact.value !== 'unknown' ? 'gallerySystem' : undefined
      case 'googleMapsReviews': return fact.value !== null && fact.value >= rules.thresholds.googleMapsReviews ? 'googleMapsReviews' : undefined
      case 'googleMapsRating': return fact.value !== null && fact.value >= rules.thresholds.googleMapsRating ? 'googleMapsRating' : undefined
      default: return undefined
    }
  }
  for (const factKey of researchFactKeySchema.options) {
    const fact = factsByKey.get(factKey)
    if (!fact) continue
    const ruleId = match(fact)
    if (ruleId) matchedRules.push({ ruleId, factKey, sourceRef: fact.sourceRef, points: rules.weights[ruleId] })
    if (fact.key === 'businessStatus' && fact.value === 'suspended') flags.push('business_suspended')
    if (fact.key === 'businessStatus' && fact.value === 'removed') flags.push('business_removed')
    if (fact.key === 'photographicPkd' && fact.value === false) flags.push('non_photographic_pkd')
  }
  const categoryFact = factsByKey.get('category')
  const category = categoryFact?.key === 'category' && categoryFact.value !== null ? categoryFact.value : 'unknown'
  const score = Math.min(100, matchedRules.reduce((sum, rule) => sum + rule.points, 0))
  const suggestedAction = flags.length > 0
    ? 'review'
    : category === 'product_commercial' || score < rules.contactThreshold ? 'observe' : 'qualify_contact'
  const unknownFactKeys = researchFactKeySchema.options.filter((factKey) => {
    const fact = factsByKey.get(factKey)
    return !fact || fact.value === 'unknown'
  })
  return scoreSnapshotSchema.parse({
    schemaVersion: 1,
    evaluationId: facts.evaluationId,
    factsRef: input.factsRef,
    rulesVersion: rules.version,
    evaluatedAt: facts.evaluatedAt,
    score,
    matchedRules,
    flags,
    category,
    suggestedAction,
    unknownFactKeys,
  })
}
