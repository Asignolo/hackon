import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { processSyntheticWorkflow } from '../lib/synthetic-workflow-runtime'

export const metadata: WorkerMeta = { queue: 'photographers-synthetic-workflow', id: 'photographers:synthetic-workflow', concurrency: 1 }

export default async function handle(job: QueuedJob<unknown>, _context: JobContext): Promise<void> {
  const container = await createRequestContainer()
  await processSyntheticWorkflow(job.payload, container)
}
