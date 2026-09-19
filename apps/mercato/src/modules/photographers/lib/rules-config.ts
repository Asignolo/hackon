import { z } from 'zod'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { TenantSetupScope } from '@open-mercato/shared/modules/setup'

export const HIDDEN_POTENTIAL_RULES_KEY = 'hidden_potential_rules'
const weight = z.number().int().min(0).max(100)
export const hiddenPotentialRulesSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1).max(100),
  identityRulesVersion: z.literal('q1-exact-email-v1'),
  contactThreshold: z.number().int().min(0).max(100),
  autoApproveThreshold: z.number().min(0).max(1),
  eligibilityValidityHours: z.number().int().min(1).max(24),
  weights: z.object({
    nipConfirmed: weight, businessOlderThanTwoYears: weight, vatActive: weight,
    photographicPkd: weight, showsPrint: weight, instagramRecentPost: weight,
    instagramFollowers: weight, instagramEngagement: weight, facebookRecentPost: weight,
    ownDomain: weight, websiteCurrent: weight, bookingCalendar: weight,
    gallerySystem: weight, googleMapsReviews: weight, googleMapsRating: weight,
  }).strict(),
  thresholds: z.object({
    recentPostDays: z.number().int().positive(),
    instagramFollowers: z.number().int().nonnegative(),
    instagramEngagement: z.number().nonnegative(),
    engagementPostCount: z.literal(12),
    googleMapsReviews: z.number().int().nonnegative(),
    googleMapsRating: z.number().min(0).max(5),
  }).strict(),
  limits: z.object({
    batchSize: z.number().int().min(1).max(200),
    concurrentEvaluations: z.number().int().min(1).max(2),
    concurrentResearchBranches: z.number().int().min(1).max(3),
    transientRetries: z.number().int().min(0).max(2),
    discoverySeconds: z.number().int().min(1).max(120),
    discoveryToolCalls: z.number().int().min(1).max(12),
    machineWorkSeconds: z.number().int().min(1).max(600),
  }).strict(),
  observationIntervalsDays: z.tuple([z.literal(14), z.literal(28), z.literal(56), z.literal(112), z.literal(180)]),
  backfillOnInstall: z.literal(false),
}).strict()
export type HiddenPotentialRules = z.infer<typeof hiddenPotentialRulesSchema>

export const DEFAULT_HIDDEN_POTENTIAL_RULES: HiddenPotentialRules = {
  schemaVersion: 1,
  version: '2026-09-19.1',
  identityRulesVersion: 'q1-exact-email-v1',
  contactThreshold: 60,
  autoApproveThreshold: 0.9,
  eligibilityValidityHours: 24,
  weights: {
    nipConfirmed: 20, businessOlderThanTwoYears: 20, vatActive: 15, photographicPkd: 5,
    showsPrint: 10, instagramRecentPost: 5, instagramFollowers: 5, instagramEngagement: 5,
    facebookRecentPost: 5, ownDomain: 5, websiteCurrent: 5, bookingCalendar: 5,
    gallerySystem: 5, googleMapsReviews: 5, googleMapsRating: 5,
  },
  thresholds: {
    recentPostDays: 30, instagramFollowers: 1000, instagramEngagement: 0.03,
    engagementPostCount: 12, googleMapsReviews: 20, googleMapsRating: 4.7,
  },
  limits: {
    batchSize: 200, concurrentEvaluations: 2, concurrentResearchBranches: 3,
    transientRetries: 2, discoverySeconds: 120, discoveryToolCalls: 12, machineWorkSeconds: 600,
  },
  observationIntervalsDays: [14, 28, 56, 112, 180],
  backfillOnInstall: false,
}

export async function loadHiddenPotentialRules(service: ModuleConfigService, scope: TenantSetupScope): Promise<HiddenPotentialRules> {
  const value = await service.getValue('photographers', HIDDEN_POTENTIAL_RULES_KEY, { scope })
  return hiddenPotentialRulesSchema.parse(value ?? DEFAULT_HIDDEN_POTENTIAL_RULES)
}

export async function installHiddenPotentialRules(service: ModuleConfigService, scope: TenantSetupScope): Promise<HiddenPotentialRules> {
  const existing = await service.getRecord('photographers', HIDDEN_POTENTIAL_RULES_KEY, scope)
  const rules = hiddenPotentialRulesSchema.parse(existing?.value ?? DEFAULT_HIDDEN_POTENTIAL_RULES)
  if (!existing) {
    const saved = await service.setValue('photographers', HIDDEN_POTENTIAL_RULES_KEY, rules, scope)
    if (!saved) throw new Error('[internal] Hidden potential rules could not be persisted')
  }
  return rules
}
