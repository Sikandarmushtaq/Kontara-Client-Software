import type { Metadata } from 'next';
import { EstimatesClient } from '@/components/estimates/estimates-client';
import { createServerSupabase } from '@/lib/supabase-server';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Account Estimates | Kontrora' };

export default async function AccountEstimatesPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  // Show only the actions the current user may take. The server APIs and SQL
  // independently enforce all financial access, regardless of UI visibility.
  const supabase = await createServerSupabase();
  if (!supabase) return <p className="p-6">Database not configured.</p>;
  const { data: canView, error: viewError } = await supabase.rpc('can_access_estimate', {
    p_account_id: accountId,
    p_permission: 'view_estimates',
  });
  if (viewError || canView !== true) return (
    <section className="p-6">
      <h1 className="text-2xl font-semibold">Estimates access unavailable</h1>
      <p className="mt-2 text-muted-foreground">You do not have permission to view this account's financial estimates.</p>
      <Link href="/estimates" className="mt-4 inline-block text-primary underline">Back to Estimates</Link>
    </section>
  );
  const { data: canManage } = await supabase.rpc('can_access_estimate', {
    p_account_id: accountId,
    p_permission: 'manage_estimates',
  });
  return <EstimatesClient accountId={accountId} canManage={canManage === true} />;
}
