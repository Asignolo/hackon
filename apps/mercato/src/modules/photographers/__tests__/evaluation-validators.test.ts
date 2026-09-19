import {
  eligibilityCreateSchema, evaluationMaterialSchema, evaluationStartSchema,
  factsSnapshotSchema, messageSnapshotSchema, researchFactSchema, scoreSnapshotSchema,
  traceEvidenceSchema, tracesSnapshotSchema,
} from '../data/validators'

const evaluationId = '11111111-1111-4111-8111-111111111111'
const factsRef = '22222222-2222-4222-8222-222222222222'
const observedAt = '2026-09-19T12:00:00Z'
const trace = {
  schemaVersion: 1, id: factsRef, kind: 'website', value: 'https://example.test',
  status: 'confirmed', provenance: [{ value: 'https://example.test', sourceRef: 'registration', observedAt }],
  observedAt, candidateIds: [],
}
const fact = {
  schemaVersion: 1, key: 'instagramFollowers', value: 1000, state: 'known', traceId: factsRef,
  sourceRef: 'https://example.test', observedAt, readStatus: 'ok', owner: 'social',
}
const score = {
  schemaVersion: 1, evaluationId, factsRef, rulesVersion: '2026-09-19.1', evaluatedAt: observedAt,
  score: 5, matchedRules: [{ ruleId: 'instagramFollowers', factKey: 'instagramFollowers', sourceRef: 'https://example.test', points: 5 }],
  flags: [], category: 'wedding', suggestedAction: 'observe', unknownFactKeys: [],
}

describe('hidden potential material contracts', () => {
  it('rejects caller supplied confirmation identity and validates batch boundaries', () => {
    expect(eligibilityCreateSchema.safeParse({
      photographerId: factsRef, requestId: evaluationId, status: 'no_orders_confirmed',
      checkedAt: observedAt, sourceRef: 'store-export', confirmedBy: evaluationId,
    }).success).toBe(false)
    expect(evaluationStartSchema.safeParse({ registrationIds: [factsRef], requestId: evaluationId }).success).toBe(true)
    expect(evaluationStartSchema.safeParse({ registrationIds: [factsRef, factsRef], requestId: evaluationId }).success).toBe(false)
    const ids = Array.from({ length: 201 }, (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`)
    expect(evaluationStartSchema.safeParse({ registrationIds: ids.slice(0, 200), requestId: evaluationId }).success).toBe(true)
    expect(evaluationStartSchema.safeParse({ registrationIds: ids, requestId: evaluationId }).success).toBe(false)
  })

  it('requires null for unknown facts without turning inaccessible counts into zero', () => {
    expect(researchFactSchema.safeParse(fact).success).toBe(true)
    expect(researchFactSchema.safeParse({ ...fact, state: 'unknown', value: null, readStatus: 'blocked' }).success).toBe(true)
    expect(researchFactSchema.safeParse({ ...fact, state: 'unknown', value: 0 }).success).toBe(false)
    expect(researchFactSchema.safeParse({ ...fact, readStatus: 'blocked' }).success).toBe(false)
    expect(researchFactSchema.safeParse({ ...fact, value: '1000' }).success).toBe(false)
    expect(researchFactSchema.safeParse({ ...fact, owner: 'registry' }).success).toBe(false)
  })

  it('marks engagement based on fewer than twelve posts as partial', () => {
    const engagement = { ...fact, key: 'instagramEngagement', value: { rate: 0.04, analyzedPostCount: 11 } }
    expect(researchFactSchema.safeParse(engagement).success).toBe(false)
    expect(researchFactSchema.safeParse({ ...engagement, readStatus: 'partial' }).success).toBe(true)
    expect(researchFactSchema.safeParse({ ...engagement, value: { rate: 0.04, analyzedPostCount: 13 } }).success).toBe(false)
  })

  it('prevents rejected evidence from being marked confirmed and bounds candidates', () => {
    expect(traceEvidenceSchema.safeParse(trace).success).toBe(true)
    expect(traceEvidenceSchema.safeParse({ ...trace, rejectionRef: evaluationId }).success).toBe(false)
    expect(traceEvidenceSchema.safeParse({ ...trace, candidateIds: [factsRef, factsRef] }).success).toBe(false)
    expect(tracesSnapshotSchema.safeParse({ schemaVersion: 1, evaluationId, evaluatedAt: observedAt, discoveryStatus: 'complete', traces: Array(101).fill(trace) }).success).toBe(false)
  })

  it('requires a canonical fact value instead of duplicate evidence inflating points', () => {
    const snapshot = { schemaVersion: 1, evaluationId, evaluatedAt: observedAt, tracesRef: factsRef, facts: [fact, fact] }
    expect(factsSnapshotSchema.safeParse(snapshot).success).toBe(false)
    expect(scoreSnapshotSchema.safeParse({ ...score, score: 10, matchedRules: [...score.matchedRules, ...score.matchedRules] }).success).toBe(false)
    expect(scoreSnapshotSchema.safeParse({ ...score, score: 6 }).success).toBe(false)
  })

  it('requires review for a flag even at high scores', () => {
    expect(scoreSnapshotSchema.safeParse(score).success).toBe(true)
    expect(scoreSnapshotSchema.safeParse({ ...score, flags: ['business_suspended'], suggestedAction: 'qualify_contact' }).success).toBe(false)
    expect(scoreSnapshotSchema.safeParse({ ...score, flags: ['business_suspended'], suggestedAction: 'review' }).success).toBe(true)
  })

  it('limits messages and disallows recipient overrides', () => {
    const message = { schemaVersion: 1, evaluationId, recipientSource: 'registration', body: 'Hello', allowedEvidenceRefs: [], internalRationale: 'Print shown', createdAt: observedAt, factsRef }
    expect(messageSnapshotSchema.safeParse(message).success).toBe(true)
    expect(messageSnapshotSchema.parse({ ...message, body: '  Hello\n' }).body).toBe('  Hello\n')
    expect(messageSnapshotSchema.safeParse({ ...message, body: 'a'.repeat(2001) }).success).toBe(false)
    expect(messageSnapshotSchema.safeParse({ ...message, recipient: 'other@example.test' }).success).toBe(false)
    expect(evaluationMaterialSchema.safeParse({ kind: 'score', data: message }).success).toBe(false)
  })

  it('enforces the logical byte limit using UTF-8, not string length', () => {
    const snapshot = {
      schemaVersion: 1, evaluationId, evaluatedAt: observedAt, discoveryStatus: 'complete',
      traces: Array.from({ length: 25 }, () => ({ ...trace, value: 'ą'.repeat(2048), provenance: [{ ...trace.provenance[0], value: 'ą'.repeat(2048) }] })),
    }
    expect(JSON.stringify(snapshot).length).toBeLessThan(128 * 1024)
    expect(tracesSnapshotSchema.safeParse(snapshot).success).toBe(false)
  })
})
