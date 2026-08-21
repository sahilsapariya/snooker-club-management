import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';
import type { Database, Json } from '@/types/database.types';

const log = logger.child('activity');

export type ActivityEntry = Database['public']['Functions']['tenant_activity']['Returns'][number];

/**
 * What happened, who did it, and in which club.
 *
 * Three things are deliberately NOT parameters: the actor, their role, and the
 * timestamp. `public.log_activity` fills all three from the database session,
 * so a client cannot attribute an action to somebody else or backdate it. The
 * function is SECURITY INVOKER, which means writing an entry for a club you are
 * not a member of is refused by the same policy that refuses the data itself.
 *
 * The club is always named. In a product where one owner runs several clubs, an
 * audit line reading "table deactivated" without saying *where* is worse than
 * no line at all.
 */
export interface ActivityInput {
  readonly tenantId: string | null;
  readonly action: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly summary?: string;
  readonly metadata?: Record<string, Json>;
}

/**
 * Records an entry, and never throws.
 *
 * Audit logging accompanies an action that has already succeeded. If the club
 * was suspended between the write and the log, or the network dropped, the
 * right outcome is a missing audit line and a warning - not an error thrown at
 * a receptionist who has already taken the customer's money.
 */
export async function recordActivity(input: ActivityInput): Promise<void> {
  const { error } = await supabase.rpc('log_activity', {
    p_action: input.action,
    // Omitted rather than passed as null: a null tenant means a platform-level
    // event, and the generated argument type has no null to express that.
    ...(input.tenantId === null ? {} : { p_tenant_id: input.tenantId }),
    ...(input.entityType === undefined ? {} : { p_entity_type: input.entityType }),
    ...(input.entityId === undefined ? {} : { p_entity_id: input.entityId }),
    ...(input.summary === undefined ? {} : { p_summary: input.summary }),
    ...(input.metadata === undefined ? {} : { p_metadata: input.metadata }),
  });

  if (error) {
    log.warn('Could not record activity', { action: input.action, error: error.message });
  }
}

/**
 * The club's recent history.
 *
 * Owner-readable only - the SELECT policy on `activity_logs` requires
 * `can_manage_tenant`, so a receptionist calling this receives an empty list
 * rather than an error. That is intentional: staff generate the trail, owners
 * read it.
 */
export async function fetchTenantActivity(tenantId: string, limit = 50): Promise<ActivityEntry[]> {
  const result = await supabase.rpc('tenant_activity', { p_tenant_id: tenantId, p_limit: limit });
  return unwrap(result, 'load club activity') ?? [];
}
