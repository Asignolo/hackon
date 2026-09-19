import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

export const metadata: WorkerMeta = { queue: 'photographers-evaluation-review', id: 'photographers:evaluation-review', concurrency: 1 }

export default async function handle(job: QueuedJob<unknown>, _context: JobContext) {
  const container = await createRequestContainer()
  try {
    const { processEvaluationReviewJob } = await import('../lib/evaluation-review-workflow')
    return await processEvaluationReviewJob(job.payload, container)
  } finally { await container.dispose() }
}
