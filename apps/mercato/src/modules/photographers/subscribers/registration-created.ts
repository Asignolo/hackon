export const metadata = { event: 'photographers.raw_data.created', persistent: true, id: 'photographers:registration-created' }

export default async function handle(payload: unknown, ctx: { resolve<T = unknown>(name: string): T }) {
  await ctx.resolve<(input: unknown) => Promise<void>>('photographerRegistrationPrepare')(payload)
}
