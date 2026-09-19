import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
import { proposalReviewAccessInterceptor } from '../lib/proposal-review-access'

import { demoProposalDispositionInterceptor } from '../lib/demo-proposal-interceptor'

export const interceptors: CommandInterceptor[] = [proposalReviewAccessInterceptor, demoProposalDispositionInterceptor]
