
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  apiJson,
  authorizeEstimate,
  findEstimate,
  validUUID,
} from '@/lib/estimates-api';

export const dynamic = 'force-dynamic';

type Context = {
  params: Promise<{
    accountId: string;
    estimateId: string;
  }>;
};

const schema = z.object({
  status: z.enum(['sent', 'accepted', 'rejected']),
});

export async function POST(
  request: NextRequest,
  { params }: Context
) {
  const { accountId, estimateId } = await params;

  if (!validUUID(accountId) || !validUUID(estimateId)) {
    return apiJson({ error: 'Invalid ID' }, 400);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return apiJson({ error: 'Invalid JSON' }, 400);
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return apiJson({ error: 'Invalid status' }, 400);
  }

  const status = parsed.data.status;

  const permission =
    status === 'sent'
      ? 'manage_estimates'
      : 'approve_estimates';

  const auth = await authorizeEstimate(
    request,
    accountId,
    permission
  );

  if (auth instanceof NextResponse) return auth;

  const { error } = await auth.client.rpc(
    'transition_account_estimate',
    {
      p_account_id: accountId,
      p_estimate_id: estimateId,
      p_status: status,
    }
  );

  if (error) {
    console.error('Estimate transition error:', error);

    return apiJson(
      { error: error.message },
      400
    );
  }

  return await findEstimate(
    auth.client,
    accountId,
    estimateId
  ).then((result) =>
    result instanceof NextResponse
      ? result
      : apiJson(result)
  );
}
