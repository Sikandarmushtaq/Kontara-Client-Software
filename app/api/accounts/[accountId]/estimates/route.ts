import { NextRequest, NextResponse } from 'next/server';
import {
  apiJson, authorizeEstimate, estimateColumns,
  estimateDraftSchema, findEstimate, statusSchema, validUUID,
} from '@/lib/estimates-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ accountId: string }> };

/** GET /api/accounts/:accountId/estimates?status=draft&projectId=...&limit=20&offset=0 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { accountId } = await params;
  if (!validUUID(accountId)) return apiJson({ error: 'Invalid account ID' }, 400);

  const authorized = await authorizeEstimate(request, accountId, 'view_estimates');
  if (authorized instanceof NextResponse) return authorized;

  const query = request.nextUrl.searchParams;
  const status = query.get('status');
  const projectId = query.get('projectId');
  const limitRaw = query.get('limit') ?? '20';
  const offsetRaw = query.get('offset') ?? '0';

  if (status && !statusSchema.safeParse(status).success) {
    return apiJson({ error: 'Invalid status filter' }, 400);
  }
  if (projectId && !validUUID(projectId)) {
    return apiJson({ error: 'Invalid project ID' }, 400);
  }
  if (!/^[0-9]+$/.test(limitRaw) || !/^[0-9]+$/.test(offsetRaw)) {
    return apiJson({ error: 'Invalid pagination' }, 400);
  }
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    return apiJson({ error: 'Pagination is out of range' }, 400);
  }

  let select = authorized.client
    .from('estimates')
    .select(estimateColumns, { count: 'exact' })
    .eq('account_id', accountId);
  if (status) select = select.eq('status', status);
  if (projectId) select = select.eq('project_id', projectId);

  const { data, error, count } = await select
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('List estimates failed:', error.code, error.message);
    return apiJson({ error: 'Failed to list estimates' }, 500);
  }
  return apiJson({ estimates: data ?? [], count: count ?? 0, limit, offset });
}

/** POST /api/accounts/:accountId/estimates; requires unique Idempotency-Key header. */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { accountId } = await params;
  if (!validUUID(accountId)) return apiJson({ error: 'Invalid account ID' }, 400);

  const authorized = await authorizeEstimate(request, accountId, 'manage_estimates');
  if (authorized instanceof NextResponse) return authorized;

  const key = request.headers.get('Idempotency-Key');
  if (!key || key.length < 8 || key.length > 128) {
    return apiJson({ error: 'Idempotency-Key must contain 8 to 128 characters' }, 400);
  }
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return apiJson({ error: 'Content-Type must be application/json' }, 415);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiJson({ error: 'Invalid JSON request body' }, 400);
  }
  const parsed = estimateDraftSchema.safeParse(payload);
  if (!parsed.success) {
    return apiJson({ error: 'Invalid estimate', fields: parsed.error.issues.map(i => i.path.join('.')) }, 400);
  }

  // SQL computes the totals, validates tenancy and performs an atomic insert.
  // Do not calculate totals via floating-point JavaScript arithmetic.
  const { data: estimateId, error: insertError } = await authorized.client.rpc('create_account_estimate', {
    p_account_id: accountId,
    p_key: key,
    p_data: parsed.data,
  });

  if (insertError) {
    const msg = insertError.message.toLowerCase();
    if (msg.includes('idempotency key reused')) return apiJson({ error: 'Idempotency key reused with different payload' }, 409);
    if (msg.includes('forbidden')) return apiJson({ error: 'Not authorized' }, 403);
    if (msg.includes('invalid') || msg.includes('requires') || msg.includes('does not belong')) {
      return apiJson({ error: 'Estimate validation failed' }, 400);
    }
    console.error('Create estimate RPC failed:', insertError.code, insertError.message);
    return apiJson({ error: 'Failed to create estimate' }, 500);
  }

  if (typeof estimateId !== 'string' || !validUUID(estimateId)) {
    return apiJson({ error: 'Failed to retrieve created estimate ID' }, 500);
  }
  const result = await findEstimate(authorized.client, accountId, estimateId);
  if (result instanceof NextResponse) return result;
  return NextResponse.json(result, {
    status: 201,
    headers: {
      'Cache-Control': 'private, no-store',
      'Location': `/api/accounts/${accountId}/estimates/${estimateId}`,
    },
  });
}
