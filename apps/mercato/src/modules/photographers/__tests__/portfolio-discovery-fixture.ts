export function discoveryResearch() {
  return { kind: 'research', data: {
    schemaVersion: 1, status: 'no_results', stopReason: 'budget_exhausted',
    portfolio: { kind: 'missing', originalValue: '', normalizedValue: null, resolvedUrl: null, status: 'unresolved' },
    links: [], nip: [], city: [],
    coverage: { website: 'not_checked', contact: 'not_checked', instagram: 'not_checked', facebook: 'not_checked', google_maps: 'not_checked', nip: 'not_checked' },
    approvalRequired: false, attempts: [], summary: 'Brak trafień; poszukiwanie nieukończone.',
  } }
}
