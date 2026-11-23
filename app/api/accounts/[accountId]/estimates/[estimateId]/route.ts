import { NextRequest, NextResponse } from 'next/server';
import {
  apiJson, authorizeEstimate, estimateDraftSchema, findEstimate, validUUID,
  type ApiSupabase,
} from '@/lib/estimates-api';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ accountId: string; estimateId: string }> };

async function readCapabilities(
  client: ApiSupabase,
  accountId: string,
) {
  const [manageResult, approveResult] = await Promise.all([
    client.rpc('can_access_estimate', { p_account_id: accountId, p_permission: 'manage_estimates' }),
    client.rpc('can_access_estimate', { p_account_id: accountId, p_permission: 'approve_estimates' }),
  ]);
  if (manageResult.error || approveResult.error) {
    console.error('Estimate capability lookup failed', manageResult.error?.code, approveResult.error?.code);
    return null;
  }
  return { can_manage: manageResult.data === true, can_approve: approveResult.data === true };
}

/** GET /api/accounts/:accountId/estimates/:estimateId */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { accountId, estimateId } = await params;
  if (!validUUID(accountId) || !validUUID(estimateId)) return apiJson({ error: 'Invalid ID format' }, 400);
  const authorized = await authorizeEstimate(request, accountId, 'view_estimates');
  if (authorized instanceof NextResponse) return authorized;
  const result = await findEstimate(authorized.client, accountId, estimateId);
  if (result instanceof NextResponse) return result;
  const capabilities = await readCapabilities(authorized.client, accountId);
  if (!capabilities) return apiJson({ error: 'Unable to verify financial permissions' }, 500);
  return apiJson({ ...result, capabilities });
}

/** PATCH edits only draft estimates; PostgreSQL locks row and recomputes money atomically. */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { accountId, estimateId } = await params;
  if (!validUUID(accountId) || !validUUID(estimateId)) return apiJson({ error: 'Invalid ID format' }, 400);
  const authorized = await authorizeEstimate(request, accountId, 'manage_estimates');
  if (authorized instanceof NextResponse) return authorized;
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return apiJson({ error: 'Content-Type must be application/json' }, 415);
  }
  let input: unknown;
  try { input = await request.json(); } catch { return apiJson({ error: 'Invalid JSON body' }, 400); }
  const parsed = estimateDraftSchema.safeParse(input);
  if (!parsed.success) return apiJson({ error: 'Invalid estimate', fields: parsed.error.issues.map(i => i.path.join('.')) }, 400);

  const { error } = await authorized.client.rpc('update_account_estimate_draft', {
    p_account_id: accountId,
    p_estimate_id: estimateId,
    p_data: parsed.data,
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('forbidden')) return apiJson({ error: 'Not authorized' }, 403);
    if (message.includes('not found')) return apiJson({ error: 'Estimate not found' }, 404);
    if (message.includes('only drafts')) return apiJson({ error: 'Only draft estimates can be edited' }, 409);
    if (message.includes('invalid') || message.includes('requires') || message.includes('does not belong')) {
      return apiJson({ error: 'Invalid estimate details' }, 400);
    }
    console.error('Update estimate RPC failed:', error.code, error.message);
    return apiJson({ error: 'Failed to update estimate' }, 500);
  }
  const result = await findEstimate(authorized.client, accountId, estimateId);
  if (result instanceof NextResponse) return result;
  return apiJson(result);
}
