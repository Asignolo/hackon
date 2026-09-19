import { diagnostic } from '../diagnostics'
import type { ApifyResearchResult } from '../result'
import { completeResult, createNormalizerState, optionalBoolean, optionalNumber, optionalString } from './common'

export type InstagramProfileData = {
  username: string
  displayName: string | null
  biography: string | null
  followersCount: number | null
  followingCount: number | null
  postsCount: number | null
  isVerified: boolean | null
  isPrivate: boolean | null
  accountType: 'business' | 'creator'
  businessCategory: string | null
  externalUrl: string | null
}

function resolveAccountType(record: Record<string, unknown>): InstagramProfileData['accountType'] | null {
  const raw = record.accountType ?? record.account_type
  if (typeof raw === 'string') {
    const normalized = raw.toLowerCase()
    if (normalized === 'business') return 'business'
    if (normalized === 'creator') return 'creator'
  }
  if (record.isBusinessAccount === true) return 'business'
  if (record.isProfessionalAccount === true && record.isBusinessAccount === false) return 'creator'
  return null
}

export function normalizeInstagramProfile(input: {
  items: Array<Record<string, unknown>>
  actorRunId: string
  sourceUrl: string | null
  expectedUsername: string
}): ApifyResearchResult<InstagramProfileData> {
  const record = input.items[0]
  if (!record) {
    return {
      ok: false,
      status: 'no_data',
      platform: 'instagram',
      canonicalUrl: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      observedAt: new Date().toISOString(),
      actorRunId: input.actorRunId,
      data: null,
      unavailableFields: [],
      diagnostics: [diagnostic('no_data', 'info', 'No public Instagram profile data was returned.')],
    }
  }
  const username = record.username
  if (typeof username !== 'string' || username.toLowerCase() !== input.expectedUsername.toLowerCase()) {
    return {
      ok: false,
      status: 'error',
      platform: 'instagram',
      canonicalUrl: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      observedAt: new Date().toISOString(),
      actorRunId: input.actorRunId,
      data: null,
      unavailableFields: [{ field: 'username', reason: 'schema_changed' }],
      diagnostics: [diagnostic('schema_changed', 'error', 'Instagram profile identity could not be verified.')],
    }
  }
  const accountType = resolveAccountType(record)
  if (!accountType || record.isPrivate === true || record.private === true) {
    return {
      ok: false,
      status: 'error',
      platform: 'instagram',
      canonicalUrl: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      observedAt: new Date().toISOString(),
      actorRunId: input.actorRunId,
      data: null,
      unavailableFields: [],
      diagnostics: [diagnostic('unsupported_public_scope', 'error', 'Only confirmed public business or creator profiles are supported.')],
    }
  }
  const state = createNormalizerState()
  return completeResult({
    platform: 'instagram',
    canonicalUrl: input.sourceUrl,
    sourceUrl: input.sourceUrl,
    actorRunId: input.actorRunId,
    state,
    data: {
      username,
      displayName: optionalString(record, ['fullName', 'displayName'], 'displayName', state),
      biography: optionalString(record, ['biography'], 'biography', state, 2_000),
      followersCount: optionalNumber(record, ['followersCount'], 'followersCount', state),
      followingCount: optionalNumber(record, ['followsCount', 'followingCount'], 'followingCount', state),
      postsCount: optionalNumber(record, ['postsCount'], 'postsCount', state),
      isVerified: optionalBoolean(record, ['verified', 'isVerified'], 'isVerified', state),
      isPrivate: optionalBoolean(record, ['private', 'isPrivate'], 'isPrivate', state),
      accountType,
      businessCategory: optionalString(record, ['businessCategoryName', 'businessCategory'], 'businessCategory', state, 500),
      externalUrl: optionalString(record, ['externalUrl', 'external_url'], 'externalUrl', state, 2_048),
    },
  })
}
