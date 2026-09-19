import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

export const metadata: WorkerMeta = { queue: 'photographers-portfolio-discovery', id: 'photographers:portfolio-discovery', concurrency: 1 }

export default async function handle(job: QueuedJob<unknown>, _context: JobContext) {
  const container = await createRequestContainer()
  try {
    const { processPortfolioDiscoveryJob } = await import('../lib/portfolio-discovery-runtime')
    await processPortfolioDiscoveryJob(job.payload, container)
  } finally { await container.dispose() }
}
