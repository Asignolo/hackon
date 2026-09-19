import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { demoDispositionInputSchema, type DemoDispositionInput } from '../data/demo-proposal-validators'

export const metadata = { event: 'agent_orchestrator.proposal.disposed', persistent: true, id: 'photographers:demo-proposal-disposed' }
const eventSchema = demoDispositionInputSchema.extend({ workflowInstanceId: z.string().uuid().nullable().optional() }).passthrough()

export default async function handle(payload: unknown, ctx: { resolve<T = unknown>(name: string): T }) {
  const parsed = eventSchema.safeParse(payload)
  if (!parsed.success || !parsed.data.workflowInstanceId) return
  const { tenantId, organizationId, proposalId, workflowInstanceId } = parsed.data
  const scope = { tenantId, organizationId }
  const workflow = await findOneWithDecryption(ctx.resolve<EntityManager>('em').fork(), WorkflowInstance, { id: workflowInstanceId, workflowId: 'photographers.demo-evaluation', ...scope }, {}, scope)
  if (!workflow) return
  await ctx.resolve<(input: DemoDispositionInput) => Promise<void>>('photographerDemoDispositionEnqueue')({ ...scope, proposalId })
}
