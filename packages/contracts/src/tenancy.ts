/**
 * Two-level tenancy context (ADR-003, owner control 7).
 * Carried on every request and set as transaction-local Postgres settings that
 * the RLS policies in prisma/migrations/*_0002_rls read.
 */
export interface TenancyContext {
  readonly organizationId: string;
  /** Clinics the caller is scoped to. Empty means no clinic-scoped access. */
  readonly clinicIds: readonly string[];
  /** True only when the caller holds an explicit organisation-wide grant. */
  readonly crossClinic: boolean;
}

/** Postgres session variable names the RLS policies read. */
export const RLS_SETTINGS = {
  ORG: 'kubi.org_id',
  CLINICS: 'kubi.clinic_ids',
  CROSS_CLINIC: 'kubi.cross_clinic',
} as const;

/**
 * Serialise a context for `set_config(..., is_local => true)`.
 * MUST be applied inside a transaction: `set_config` with is_local=true is the
 * parameterisable form of SET LOCAL, and the RLS spike (T6) proves the setting
 * does not survive onto the next pool checkout.
 */
export function toRlsSettings(ctx: TenancyContext): Record<string, string> {
  return {
    [RLS_SETTINGS.ORG]: ctx.organizationId,
    [RLS_SETTINGS.CLINICS]: ctx.clinicIds.join(','),
    [RLS_SETTINGS.CROSS_CLINIC]: String(ctx.crossClinic),
  };
}
