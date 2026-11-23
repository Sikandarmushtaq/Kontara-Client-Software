
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  allowedTransition,
  formatMoney,
  percentToBps,
  priceToMinor,
  type TwoDecimalCurrency,
} from '@/lib/estimate-money';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Status = 'draft' | 'sent' | 'accepted' | 'rejected';

type Estimate = {
  id: string;
  account_id: string;
  project_id: string | null;
  title: string;
  status: Status;
  currency: TwoDecimalCurrency;
  tax_rate_bps: number;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  created_at: string;
};

type EstimateLine = {
  id: string;
  line_no: number;
  description: string;
  quantity: number;
  unit_amount_minor: number;
  line_total_minor: number;
};

type EstimateDetail = {
  estimate: Estimate;
  line_items: EstimateLine[];
  capabilities?: {
    can_manage: boolean;
    can_approve: boolean;
  };
};

type DraftLine = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

type StatusFilter = 'all' | Status;

const uuidFormat =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

const newLine = (): DraftLine => ({
  id: crypto.randomUUID(),
  description: '',
  quantity: '1',
  unitPrice: '0.00',
});

async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
  });

  const body: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : `Request failed (${response.status})`;

    throw new Error(msg);
  }

  return body as T;
}

export function EstimatesClient({
  accountId,
  canManage,
}: {
  accountId: string;
  canManage: boolean;
}) {
  const base = `/api/accounts/${encodeURIComponent(
    accountId
  )}/estimates`;

  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [currency, setCurrency] =
    useState<TwoDecimalCurrency>('USD');
  const [taxPercent, setTaxPercent] = useState('0');
  const [projectId, setProjectId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [
    newLine(),
  ]);

  const [selected, setSelected] =
    useState<EstimateDetail | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] =
    useState<string | null>(null);

  const [actionError, setActionError] =
    useState<string | null>(null);

  const [transitioning, setTransitioning] = useState(false);

  const [editingEstimateId, setEditingEstimateId] =
    useState<string | null>(null);

  const idempotencyRef = useRef<string | null>(null);

  // LOAD ESTIMATES

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);

    try {
      const query =
        filter === 'all'
          ? ''
          : `?status=${encodeURIComponent(filter)}`;

      const data = await fetchJson<{
        estimates: Estimate[];
      }>(base + query);

      setEstimates(data.estimates);
    } catch (err) {
      setListError(
        err instanceof Error
          ? err.message
          : 'Unable to load estimates'
      );

      setEstimates([]);
    } finally {
      setLoading(false);
    }
  }, [base, filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // FIX: AUTO SCROLL TO THE EDITOR
  // Runs after the form appears in the DOM.
  // Works for New Estimate and Edit Draft.

  useEffect(() => {
    if (showForm) {
      document
        .getElementById('estimate-draft-editor')
        ?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
    }
  }, [showForm, editingEstimateId]);

  function changedForm() {
    idempotencyRef.current = null;
    setFormError(null);
  }

  function updateLine(
    id: string,
    patch: Partial<DraftLine>
  ) {
    changedForm();

    setLines((prev) =>
      prev.map((line) =>
        line.id === id ? { ...line, ...patch } : line
      )
    );
  }

  // FINANCIAL CALCULATIONS

  const bps = percentToBps(taxPercent);

  const prepared = lines.map((line) => {
    const quantity = /^(?:[1-9]\d{0,4})$/.test(
      line.quantity
    )
      ? Number(line.quantity)
      : null;

    const price = priceToMinor(line.unitPrice);

    const valid =
      Boolean(line.description.trim()) &&
      line.description.trim().length <= 500 &&
      quantity !== null &&
      quantity <= 10_000 &&
      price !== null;

    const lineTotal = valid
      ? BigInt(quantity!) * BigInt(price!)
      : 0n;

    return {
      line,
      quantity,
      price,
      valid,
      lineTotal,
    };
  });

  const subtotal = prepared.reduce(
    (sum, row) => sum + row.lineTotal,
    0n
  );

  const tax =
    bps === null
      ? 0n
      : (subtotal * BigInt(bps) + 5000n) / 10000n;

  const grandTotal = subtotal + tax;

  // CREATE OR UPDATE DRAFT

  async function submit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (saving) return;

    const normalizedTitle = title.trim();

    if (!normalizedTitle || normalizedTitle.length > 200) {
      setFormError('Title must contain 1–200 characters.');
      return;
    }

    if (
      !['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'PKR'].includes(
        currency
      )
    ) {
      setFormError('Choose a supported currency.');
      return;
    }

    if (bps === null) {
      setFormError(
        'Tax must be between 0 and 100 with at most two decimal places.'
      );
      return;
    }

    if (projectId.trim() && !uuidFormat.test(projectId.trim())) {
      setFormError('Project ID must be a valid UUID.');
      return;
    }

    if (
      prepared.length < 1 ||
      prepared.length > 50 ||
      prepared.some((row) => !row.valid)
    ) {
      setFormError(
        'Enter 1–50 valid line items with quantity and price.'
      );
      return;
    }

    const requestData = {
      title: normalizedTitle,
      currency,
      tax_rate_bps: bps,
      ...(projectId.trim()
        ? { project_id: projectId.trim() }
        : {}),
      line_items: prepared.map((row) => ({
        description: row.line.description.trim(),
        quantity: row.quantity!,
        unit_amount_minor: row.price!,
      })),
    };

    if (!editingEstimateId && !idempotencyRef.current) {
      idempotencyRef.current = crypto.randomUUID();
    }

    setSaving(true);
    setFormError(null);

    try {
      const result = await fetchJson<EstimateDetail>(
        editingEstimateId
          ? `${base}/${encodeURIComponent(editingEstimateId)}`
          : base,
        {
          method: editingEstimateId ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(!editingEstimateId && idempotencyRef.current
              ? {
                  'Idempotency-Key': idempotencyRef.current,
                }
              : {}),
          },
          body: JSON.stringify(requestData),
        }
      );

      toast.success(
        editingEstimateId
          ? 'Draft updated successfully'
          : 'Draft estimate saved successfully'
      );

      idempotencyRef.current = null;
      setEditingEstimateId(null);
      setShowForm(false);

      setTitle('');
      setCurrency('USD');
      setTaxPercent('0');
      setProjectId('');
      setLines([newLine()]);

      setSelected(result);

      await Promise.all([
        refresh(),
        viewDetails(result.estimate.id),
      ]);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Could not save estimate'
      );
    } finally {
      setSaving(false);
    }
  }

  // VIEW DETAILS

  async function viewDetails(id: string) {
    setDetailLoading(true);
    setDetailError(null);

    try {
      const result = await fetchJson<EstimateDetail>(
        `${base}/${encodeURIComponent(id)}`
      );

      setSelected(result);
    } catch (err) {
      setDetailError(
        err instanceof Error
          ? err.message
          : 'Unable to load details'
      );
    } finally {
      setDetailLoading(false);
    }
  }

  // NEW ESTIMATE

  function startNew() {
    setEditingEstimateId(null);
    setTitle('');
    setCurrency('USD');
    setTaxPercent('0');
    setProjectId('');
    setLines([newLine()]);

    idempotencyRef.current = null;

    setFormError(null);
    setShowForm(true);
  }

  // EDIT DRAFT: FIXED

  function startEdit() {
    if (
      !selected ||
      selected.estimate.status !== 'draft' ||
      !selected.capabilities?.can_manage
    ) {
      return;
    }

    setEditingEstimateId(selected.estimate.id);

    setTitle(selected.estimate.title);
    setCurrency(selected.estimate.currency);

    setTaxPercent(
      String(selected.estimate.tax_rate_bps / 100)
    );

    setProjectId(selected.estimate.project_id ?? '');

    setLines(
      selected.line_items.map((item) => ({
        id: crypto.randomUUID(),
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: `${Math.floor(
          item.unit_amount_minor / 100
        )}.${String(item.unit_amount_minor % 100).padStart(
          2,
          '0'
        )}`,
      }))
    );

    idempotencyRef.current = null;
    setFormError(null);

    // React renders the editor, then the effect scrolls to it.
    setShowForm(true);
  }

  // STATUS TRANSITIONS

  async function transitionTo(
    next: 'sent' | 'accepted' | 'rejected'
  ) {
    if (!selected || transitioning) return;

    const {
      can_manage = false,
      can_approve = false,
    } = selected.capabilities ?? {};

    if (
      !allowedTransition(
        selected.estimate.status,
        next,
        can_manage,
        can_approve
      )
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Change this estimate to ${next.toUpperCase()}? This cannot be undone in the current lifecycle.`
    );

    if (!confirmed) return;

    setTransitioning(true);
    setActionError(null);

    const id = selected.estimate.id;

    try {
      await fetchJson(
        `${base}/${encodeURIComponent(id)}/transition`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: next,
          }),
        }
      );

      toast.success(`Estimate marked ${next}`);

      await Promise.all([
        viewDetails(id),
        refresh(),
      ]);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : 'Failed to change status'
      );
    } finally {
      setTransitioning(false);
    }
  }

  // USER INTERFACE

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* HEADER */}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Link
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
              href={`/accounts/${encodeURIComponent(accountId)}`}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to account
            </Link>

            <h1 className="text-2xl font-bold text-foreground">
              Estimates
            </h1>

            <p className="text-sm text-muted-foreground">
              Create account-scoped quotes and review their
              financial totals.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>

            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  if (showForm) {
                    setShowForm(false);
                    setEditingEstimateId(null);
                  } else {
                    startNew();
                  }
                }}
              >
                <Plus className="h-4 w-4" />
                {showForm ? 'Close editor' : 'New estimate'}
              </Button>
            )}
          </div>
        </div>

        {/* CREATE / EDIT FORM */}

        {showForm && (
          <Card
            id="estimate-draft-editor"
            className="scroll-mt-24"
          >
            <CardHeader>
              <CardTitle>
                {editingEstimateId
                  ? 'Edit draft estimate'
                  : 'Create draft estimate'}
              </CardTitle>

              <p className="text-sm text-muted-foreground">
                Prices are entered as dollars and stored in cents.
              </p>
            </CardHeader>

            <CardContent>
              <form
                onSubmit={(event) => void submit(event)}
                className="space-y-5"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm font-medium">
                    Title
                    <Input
                      maxLength={200}
                      value={title}
                      onChange={(e) => {
                        changedForm();
                        setTitle(e.target.value);
                      }}
                      placeholder="Website Redesign Proposal"
                      required
                    />
                  </label>

                  <label className="space-y-1.5 text-sm font-medium">
                    Currency
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={currency}
                      onChange={(e) => {
                        changedForm();
                        setCurrency(
                          e.target.value as TwoDecimalCurrency
                        );
                      }}
                    >
                      {(
                        [
                          'USD',
                          'EUR',
                          'GBP',
                          'CAD',
                          'AUD',
                          'PKR',
                        ] as const
                      ).map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5 text-sm font-medium">
                    Tax rate (%)
                    <Input
                      value={taxPercent}
                      onChange={(e) => {
                        changedForm();
                        setTaxPercent(e.target.value);
                      }}
                      inputMode="decimal"
                      placeholder="10.00"
                      required
                    />
                  </label>

                  <label className="space-y-1.5 text-sm font-medium">
                    Project ID (optional)
                    <Input
                      value={projectId}
                      onChange={(e) => {
                        changedForm();
                        setProjectId(e.target.value);
                      }}
                      placeholder="Paste project UUID"
                    />
                  </label>
                </div>

                {/* LINE ITEMS */}

                <div className="space-y-3">
                  <h3 className="font-semibold">
                    Line items
                  </h3>

                  {lines.map((line, index) => (
                    <div
                      key={line.id}
                      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_110px_130px_38px] sm:items-end"
                    >
                      <label className="space-y-1 text-sm">
                        Description
                        <Input
                          maxLength={500}
                          value={line.description}
                          onChange={(e) =>
                            updateLine(line.id, {
                              description: e.target.value,
                            })
                          }
                          placeholder={`Service ${index + 1}`}
                          required
                        />
                      </label>

                      <label className="space-y-1 text-sm">
                        Quantity
                        <Input
                          inputMode="numeric"
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.id, {
                              quantity: e.target.value,
                            })
                          }
                          required
                        />
                      </label>

                      <label className="space-y-1 text-sm">
                        Unit price
                        <Input
                          inputMode="decimal"
                          value={line.unitPrice}
                          onChange={(e) =>
                            updateLine(line.id, {
                              unitPrice: e.target.value,
                            })
                          }
                          placeholder="500.00"
                          required
                        />
                      </label>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove line ${index + 1}`}
                        disabled={lines.length === 1}
                        onClick={() => {
                          changedForm();
                          setLines((prev) =>
                            prev.filter(
                              (item) => item.id !== line.id
                            )
                          );
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={lines.length >= 50}
                    onClick={() => {
                      changedForm();
                      setLines((prev) => [
                        ...prev,
                        newLine(),
                      ]);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Add line
                  </Button>
                </div>

                {/* FINANCIAL SUMMARY */}

                <div className="ml-auto max-w-sm space-y-1 rounded-lg border border-border p-4 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>
                      {formatMoney(Number(subtotal), currency)}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span>Tax</span>
                    <span>
                      {formatMoney(Number(tax), currency)}
                    </span>
                  </div>

                  <div className="flex justify-between border-t border-border pt-2 font-semibold">
                    <span>Total</span>
                    <span>
                      {formatMoney(Number(grandTotal), currency)}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Final amounts are recalculated in PostgreSQL.
                  </p>
                </div>

                {formError && (
                  <p
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {formError}
                  </p>
                )}

                <div className="flex justify-end">
                  <Button type="submit" disabled={saving}>
                    {saving
                      ? 'Saving…'
                      : editingEstimateId
                        ? 'Save draft changes'
                        : 'Save draft estimate'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ESTIMATES LIST */}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>
                Account estimates
              </CardTitle>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Status
                <select
                  className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
                  value={filter}
                  onChange={(e) =>
                    setFilter(
                      e.target.value as StatusFilter
                    )
                  }
                >
                  <option value="all">All</option>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
            </div>
          </CardHeader>

          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">
                Loading estimates…
              </p>
            ) : listError ? (
              <p
                role="alert"
                className="text-sm text-destructive"
              >
                {listError}
              </p>
            ) : estimates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No estimates found for this account/filter.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estimate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">
                      Details
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {estimates.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.title}
                      </TableCell>

                      <TableCell>
                        <Badge variant="secondary">
                          {row.status}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        {formatMoney(
                          row.total_minor,
                          row.currency
                        )}
                      </TableCell>

                      <TableCell>
                        {new Date(
                          row.created_at
                        ).toLocaleDateString()}
                      </TableCell>

                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void viewDetails(row.id)
                          }
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* DETAILS */}

        {detailLoading && (
          <p className="text-sm text-muted-foreground">
            Loading estimate details…
          </p>
        )}

        {detailError && (
          <p
            role="alert"
            className="text-sm text-destructive"
          >
            {detailError}
          </p>
        )}

        {actionError && (
          <p
            role="alert"
            className="text-sm text-destructive"
          >
            {actionError}
          </p>
        )}

        {selected && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {selected.estimate.title}
                </CardTitle>

                <Badge variant="secondary">
                  {selected.estimate.status}
                </Badge>
              </div>

              {/* ACTION BUTTONS */}

              <div className="mt-3 flex flex-wrap gap-2">
                {selected.estimate.status === 'draft' &&
                  selected.capabilities?.can_manage && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={startEdit}
                        disabled={transitioning || saving}
                      >
                        <Pencil className="h-4 w-4" />
                        Edit draft
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          void transitionTo('sent')
                        }
                        disabled={transitioning || saving}
                      >
                        <Send className="h-4 w-4" />
                        Mark sent
                      </Button>
                    </>
                  )}

                {selected.estimate.status === 'sent' &&
                  selected.capabilities?.can_approve && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          void transitionTo('accepted')
                        }
                        disabled={transitioning}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Accept
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void transitionTo('rejected')
                        }
                        disabled={transitioning}
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    </>
                  )}

                {['accepted', 'rejected'].includes(
                  selected.estimate.status
                ) && (
                  <p className="text-sm text-muted-foreground">
                    Final decision recorded; this estimate is
                    read-only.
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Status changes require server-side finance
                permissions; hidden buttons do not grant access.
              </p>
            </CardHeader>

            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {selected.line_items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.description}
                      </TableCell>

                      <TableCell>
                        {item.quantity}
                      </TableCell>

                      <TableCell>
                        {formatMoney(
                          item.unit_amount_minor,
                          selected.estimate.currency
                        )}
                      </TableCell>

                      <TableCell>
                        {formatMoney(
                          item.line_total_minor,
                          selected.estimate.currency
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="ml-auto max-w-sm space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>
                    {formatMoney(
                      selected.estimate.subtotal_minor,
                      selected.estimate.currency
                    )}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span>Tax</span>
                  <span>
                    {formatMoney(
                      selected.estimate.tax_minor,
                      selected.estimate.currency
                    )}
                  </span>
                </div>

                <div className="flex justify-between border-t border-border pt-2 font-bold">
                  <span>Total</span>
                  <span>
                    {formatMoney(
                      selected.estimate.total_minor,
                      selected.estimate.currency
                    )}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
