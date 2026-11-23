import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, FileText, Building2, LockKeyhole } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getCurrentUserProfileServer } from '@/lib/auth-server';
import { isSuperadmin } from '@/lib/rbac';
import { accountService } from '@/lib/account-service';
import { createAdminSupabaseClient, createServerSupabase } from '@/lib/supabase-server';
import { canShowEstimatesMenu } from '@/lib/estimates-nav';

export const metadata: Metadata = { title: 'Estimates | Kontrora' };
export const dynamic = 'force-dynamic';

export default async function EstimatesHomePage() {
  const [profile, supabase] = await Promise.all([
    getCurrentUserProfileServer(),
    createServerSupabase(),
  ]);
  if (!profile || !supabase || !canShowEstimatesMenu(profile)) {
    return (
      <section className="mx-auto max-w-4xl space-y-3 p-6">
        <h1 className="text-2xl font-semibold">Estimates</h1>
        <p className="text-muted-foreground flex items-center gap-2">
          <LockKeyhole className="h-5 w-5" /> Sign in with an authorized finance role to view estimates.
        </p>
        <Button asChild variant="outline"><Link href="/accounts">Back to accounts</Link></Button>
      </section>
    );
  }

  // Narrow potential accounts by the existing server-side account membership logic.
  // No tenant-private account is revealed without a positive finance RPC result.
  const admin = createAdminSupabaseClient();
  const candidates = admin
    ? isSuperadmin(profile)
      ? await accountService.getAllAccounts(admin)
      : await accountService.getUserAccounts(profile.id, admin)
    : [];

  const financeAccounts = (await Promise.all(candidates.map(async (account) => {
    const { data, error } = await supabase.rpc('can_access_estimate', {
      p_account_id: account.id,
      p_permission: 'view_estimates',
    });
    return !error && data === true ? account : null;
  }))).filter((account): account is NonNullable<typeof account> => account !== null);

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <h1 className="flex items-center gap-3 text-3xl font-semibold">
          <FileText className="h-7 w-7 text-primary" /> Estimates
        </h1>
        <p className="text-muted-foreground">Choose a client account to view its estimates or create a new draft.</p>
      </div>
      {financeAccounts.length === 0 ? (
        <Card><CardHeader><CardTitle>No available estimate accounts</CardTitle>
          <CardDescription>Your finance role has no accessible client accounts yet. Ask your administrator for account membership.</CardDescription>
        </CardHeader><CardContent><Button asChild variant="outline"><Link href="/accounts">Go to Accounts</Link></Button></CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {financeAccounts.map((account) => (
            <Card key={account.id} className="flex h-full flex-col">
              <CardHeader className="flex-1">
                <CardTitle className="flex items-start gap-2 text-lg">
                  <Building2 className="mt-1 h-5 w-5 shrink-0 text-primary" />
                  <span>{account.name}</span>
                </CardTitle>
                <CardDescription className="line-clamp-3">{account.description || 'Client account'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button asChild className="w-full">
                  <Link href={`/accounts/${encodeURIComponent(account.id)}/estimates`}>
                    View Estimates <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href={`/accounts/${encodeURIComponent(account.id)}`}>Account Details</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
