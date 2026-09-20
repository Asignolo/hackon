import { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { factsSnapshotSchema, type EvaluationMaterial } from '../data/evaluation-validators'
import { materialOwnersSchema } from '../data/material-validators'
import { calculateEvaluationScore } from './evaluation-scoring'
import { normalizeDemoO2Facts, DEMO_O1_SOURCE_ASSUMPTION } from './demo-o2-facts'
import { hiddenPotentialRulesSchema } from './rules-config'
import { materialOperationId } from './material-codec'

const inputSchema = z.object({
  mode: z.literal('demo'), sourceAssumption: z.literal(DEMO_O1_SOURCE_ASSUMPTION),
  evaluationId: z.string().uuid(), evaluatedAt: z.string().datetime({ offset: true }),
  o2ResultRef: z.string().uuid(),
  owners: materialOwnersSchema.extend({ registrationId: z.string().uuid(), dealId: z.string().uuid() }),
  rulesSnapshot: hiddenPotentialRulesSchema,
}).strict()

export async function storeDemoO2Evaluation(rawInput: unknown, outcome: unknown, ctx: CommandRuntimeContext) {
  const input = inputSchema.parse(rawInput)
  const normalized = normalizeDemoO2Facts(outcome, input)
  const commandBus = ctx.container.resolve<CommandBus>('commandBus')
  const save = async (part: string, material: EvaluationMaterial) => {
    const stored = await commandBus.execute<unknown, { id: string }>('photographers.evaluation.store_material', {
      input: { operationId: materialOperationId(input.evaluationId, `demo-o2:${input.o2ResultRef}:${part}`), snapshot: { ...input.owners, material } }, ctx,
    })
    return z.string().uuid().parse(stored.result.id)
  }
  const tracesRef = await save('traces', { kind: 'traces', data: normalized.traces })
  const facts = factsSnapshotSchema.parse({ schemaVersion: 1, evaluationId: input.evaluationId, evaluatedAt: input.evaluatedAt, tracesRef, facts: normalized.facts })
  const factsRef = await save('facts', { kind: 'facts', data: facts })
  const score = calculateEvaluationScore({ facts, factsRef, rules: input.rulesSnapshot })
  const scoreRef = await save(`score:${score.rulesVersion}`, { kind: 'score', data: score })
  return { tracesRef, factsRef, scoreRef, rulesVersion: score.rulesVersion, reviewRequired: score.flags.length > 0 }
}
