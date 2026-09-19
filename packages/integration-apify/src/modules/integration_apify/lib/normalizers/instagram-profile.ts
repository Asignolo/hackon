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
  return record.isBusinessAccount === true ? 'business' : null
}

function instagramErrorResult(input: {
  error: unknown
  actorRunId: string
  sourceUrl: string | null
}): ApifyResearchResult<InstagramProfileData> | null {
  if (input.error === undefined || input.error === null) return null
  const base = {
    ok: false as const,
    platform: 'instagram' as const,
    canonicalUrl: input.sourceUrl,
    sourceUrl: input.sourceUrl,
    observedAt: new Date().toISOString(),
    actorRunId: input.actorRunId,
    data: null,
    unavailableFields: [],
  }
  if (input.error === 'not_found') {
    return {
      ...base,
      status: 'no_data',
      diagnostics: [diagnostic('no_data', 'info', 'The Instagram profile was not found.')],
    }
  }
  if (input.error === 'blocked') {
    return {
      ...base,
      status: 'error',
      diagnostics: [diagnostic('platform_blocked', 'error', 'Instagram blocked the public profile lookup.')],
    }
  }
  return {
    ...base,
    status: 'error',
    diagnostics: [diagnostic('schema_changed', 'error', 'Instagram returned an unsupported error code.')],
  }
}

export function normalizeInstagramProfile(input: {
  items: Array<Record<string, unknown>>
  actorRunId: string
  sourceUrl: string | null
  expectedUsername: string
}): ApifyResearchResult<InstagramProfileData> {
  if (input.items.length === 0) {
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
  const upstreamError = instagramErrorResult({
    error: input.items[0]?.error,
    actorRunId: input.actorRunId,
    sourceUrl: input.sourceUrl,
  })
  if (upstreamError) return upstreamError
  const record = input.items.find((item) => typeof item.username === 'string'
    && item.username.toLowerCase() === input.expectedUsername.toLowerCase())
  if (!record) {
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
  const username = record.username as string
  const accountType = resolveAccountType(record)
  const privacyValues = [record.isPrivate, record.private].filter((value) => value !== undefined)
  const privacyFlags = privacyValues.filter((value): value is boolean => typeof value === 'boolean')
  const privacyIsConsistent = privacyValues.length > 0
    && privacyFlags.length === privacyValues.length
    && privacyFlags.every((value) => value === privacyFlags[0])
  if (!privacyIsConsistent) {
    return {
      ok: false,
      status: 'error',
      platform: 'instagram',
      canonicalUrl: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      observedAt: new Date().toISOString(),
      actorRunId: input.actorRunId,
      data: null,
      unavailableFields: [{ field: 'isPrivate', reason: 'schema_changed' }],
      diagnostics: [diagnostic('schema_changed', 'error', 'Instagram profile privacy could not be verified.')],
    }
  }
  const privacy = privacyFlags[0]
  if (!accountType || privacy) {
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
      diagnostics: [diagnostic('unsupported_public_scope', 'error', 'Only confirmed public business profiles are supported by the pinned Actor contract.')],
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
      isPrivate: privacy,
      accountType,
      businessCategory: optionalString(record, ['businessCategoryName', 'businessCategory'], 'businessCategory', state, 500),
      externalUrl: optionalString(record, ['externalUrl', 'external_url'], 'externalUrl', state, 2_048),
    },
  })
}
