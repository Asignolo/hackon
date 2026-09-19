import { z } from 'zod'

export const apifyCredentialsSchema = z.object({
  apiToken: z.string().trim().min(1),
})

export type ApifyCredentials = z.infer<typeof apifyCredentialsSchema>
