import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { demoDispositionInputSchema, demoEffectCheckpointSchema, demoEffectPhaseInputSchema, type DemoEffectCheckpoint } from '../data/demo-proposal-validators'
import { executeDemoEffect, executeDemoEffectPhase } from '../lib/demo-proposal-effects'
import { executeDemoUndoPhase, undoDemoEffect } from '../lib/demo-proposal-undo'
import { requirePhotographerScope } from '../lib/scope'
import { authorizeDemoCommand } from '../lib/demo-proposal-support'
import { loadDemoDecision } from '../lib/demo-proposal-decision'
import { reviewError } from '../lib/proposal-review-materials'

export const demoEffectPhaseCommand: CommandHandler<unknown, DemoEffectCheckpoint> = {
  id: 'photographers.demo.message.phase', isUndoable: false,
  async execute(input, ctx) {
    const { phase } = demoEffectPhaseInputSchema.parse(input)
    return phase.startsWith('revoke_') ? executeDemoUndoPhase(input, ctx) : executeDemoEffectPhase(input, ctx)
  },
  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    return { ...await requirePhotographerScope(ctx), actionLabel: translate('photographers.demo.audit.phase'), resourceKind: 'photographers:demo_effect', resourceId: result.proposalId, context: { phase: demoEffectPhaseInputSchema.parse(input).phase }, snapshotAfter: result, payload: { __redoInput: {} } }
  },
}

export const demoMessageAcceptCommand: CommandHandler<unknown, DemoEffectCheckpoint> = {
  id: 'photographers.message.accept', isUndoable: true,
  async execute(input, ctx) {
    if ((await loadDemoDecision(input, ctx)).disposition !== 'approved') return reviewError(409, 'material_conflict')
    return executeDemoEffect(input, ctx)
  },
  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    return { ...await requirePhotographerScope(ctx), actionLabel: translate('photographers.demo.audit.accept'), resourceKind: 'photographers:demo_effect', resourceId: result.proposalId, snapshotAfter: result, payload: { __redoInput: demoDispositionInputSchema.parse(input) } }
  },
  async undo({ ctx, logEntry }) {
    const scope = await authorizeDemoCommand(ctx)
    const result = demoEffectCheckpointSchema.parse(logEntry.snapshotAfter)
    if (logEntry.tenantId !== scope.tenantId || logEntry.organizationId !== scope.organizationId || logEntry.resourceId !== result.proposalId) return reviewError(403, 'forbidden')
    await undoDemoEffect({ ...scope, proposalId: result.proposalId }, ctx)
  },
  async redo() { return reviewError(409, 'material_conflict') },
}

export const demoMessageRejectCommand: CommandHandler<unknown, DemoEffectCheckpoint> = {
  id: 'photographers.demo.message.reject', isUndoable: false,
  async execute(input, ctx) {
    if ((await loadDemoDecision(input, ctx)).disposition !== 'rejected') return reviewError(409, 'material_conflict')
    return executeDemoEffect(input, ctx)
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return { ...await requirePhotographerScope(ctx), actionLabel: translate('photographers.demo.audit.reject'), resourceKind: 'photographers:demo_effect', resourceId: result.proposalId, snapshotAfter: result, payload: { __redoInput: {} } }
  },
}

registerCommand(demoEffectPhaseCommand)
registerCommand(demoMessageAcceptCommand)
registerCommand(demoMessageRejectCommand)
