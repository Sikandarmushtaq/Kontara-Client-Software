import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createApiSupabaseClient } from '@/lib/supabase-server';

export const uuidSchema = z.string().regex(
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
  'Invalid UUID format',
);
export const statusSchema = z.enum(['draft', 'sent', 'accepted', 'rejected']);

// Integer minor units (e.g. cents), never floating point money.
export const estimateDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'PKR']).default('USD'),
  tax_rate_bps: z.number().int().min(0).max(10_000).default(0),
  project_id: uuidSchema.nullable().optional(),
  line_items: z.array(z.strictObject({
    description: z.string().trim().min(1).max(500),
    quantity: z.number().int().min(1).max(10_000),
    unit_amount_minor: z.number().int().min(0).max(100_000_000),
  })).min(1).max(50),
});

export type ApiSupabase = NonNullable<ReturnType<typeof createApiSupabaseClient>>;

export function apiJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export function validUUID(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

/**
 * Query the database's authoritative financial permissions using the *user's*
 * session. Never use a service-role client here or infer rights from UI roles.
 */
export async function authorizeEstimate(
  request: NextRequest,
  accountId: string,
  permission: 'view_estimates' | 'manage_estimates' | 'approve_estimates',
): Promise<{ client: ApiSupabase; userId: string } | NextResponse> {
  const client = createApiSupabaseClient(request);
  if (!client) return apiJson({ error: 'Database not configured' }, 503);

  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return apiJson({ error: 'Authentication required' }, 401);

  const { data: permitted, error: permissionError } = await client.rpc('can_access_estimate', {
    p_account_id: accountId,
    p_permission: permission,
  });
  if (permissionError) {
    console.error('Estimate authorization RPC failed:', permissionError.code, permissionError.message);
    return apiJson({ error: 'Authorization check failed' }, 500);
  }
  if (permitted !== true) return apiJson({ error: 'Not authorized for this account' }, 403);

  return { client, userId: user.id };
}

export const estimateColumns = 'id,account_id,project_id,title,currency,tax_rate_bps,subtotal_minor,tax_minor,total_minor,status,created_by,created_at,updated_at,sent_at,decided_at';

export async function findEstimate(
  client: ApiSupabase,
  accountId: string,
  estimateId: string,
): Promise<NextResponse | { estimate: unknown; line_items: unknown[] }> {
  const { data: estimate, error } = await client
    .from('estimates')
    .select(estimateColumns)
    .eq('account_id', accountId)
    .eq('id', estimateId)
    .maybeSingle();

  if (error) {
    console.error('Estimate lookup failed:', error.code, error.message);
    return apiJson({ error: 'Failed to retrieve estimate' }, 500);
  }
  if (!estimate) return apiJson({ error: 'Estimate not found' }, 404);

  const { data: items, error: itemError } = await client
    .from('estimate_line_items')
    .select('id,estimate_id,line_no,description,quantity,unit_amount_minor,line_total_minor')
    .eq('estimate_id', estimateId)
    .is('removed_at', null)
    .order('line_no', { ascending: true });

  if (itemError) {
    console.error('Estimate line lookup failed:', itemError.code, itemError.message);
    return apiJson({ error: 'Failed to retrieve estimate items' }, 500);
  }
  return { estimate, line_items: items ?? [] };
}
