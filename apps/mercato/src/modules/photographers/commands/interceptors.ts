import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
import { proposalReviewAccessInterceptor } from '../lib/proposal-review-access'

export const interceptors: CommandInterceptor[] = [proposalReviewAccessInterceptor]
