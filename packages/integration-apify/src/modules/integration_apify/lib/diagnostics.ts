export type ApifyDiagnosticCode =
  | 'not_configured'
  | 'run_context_missing'
  | 'budget_exceeded'
  | 'concurrency_limited'
  | 'invalid_target'
  | 'unsupported_public_scope'
  | 'upstream_unauthorized'
  | 'upstream_forbidden'
  | 'upstream_rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'platform_blocked'
  | 'no_data'
  | 'partial_dataset'
  | 'schema_changed'
  | 'output_truncated'
  | 'cleanup_failed'

export type ApifyDiagnostic = {
  code: ApifyDiagnosticCode
  severity: 'info' | 'warning' | 'error'
  message: string
  retryable: false
  partial: boolean
}

export function diagnostic(
  code: ApifyDiagnosticCode,
  severity: ApifyDiagnostic['severity'],
  message: string,
  partial = false,
): ApifyDiagnostic {
  return { code, severity, message, retryable: false, partial }
}
