import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

export const metadata: WorkerMeta = { queue: 'photographers-demo-workflow', id: 'photographers:demo-workflow', concurrency: 1 }

export default async function handle(job: QueuedJob<unknown>, _context: JobContext) {
  const container = await createRequestContainer()
  try {
    const { processPhotographerDemoJob } = await import('../lib/demo-workflow-runtime')
    await processPhotographerDemoJob(job.payload, container)
  } finally { await container.dispose() }
}
