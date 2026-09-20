import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

export const metadata: WorkerMeta = { queue: 'photographers-apify-research', id: 'photographers:apify-research', concurrency: 1 }

export default async function handle(job: QueuedJob<unknown>, _context: JobContext) {
  const container = await createRequestContainer()
  try {
    const { processApifyResearchJob } = await import('../lib/apify-research-runtime')
    await processApifyResearchJob(job.payload, container)
  } finally { await container.dispose() }
}
