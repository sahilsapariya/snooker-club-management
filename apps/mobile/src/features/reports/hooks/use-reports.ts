import { useQueries, useQuery } from '@tanstack/react-query';

import {
  fetchDailyRevenue,
  fetchExpenseBreakdown,
  fetchOutstandingSessions,
  fetchProductSales,
  fetchRevenueSummary,
  fetchTablePerformance,
} from '../api/reports.api';
import { previousRange, type DateRange } from '../date-range';

/** Historical figures do not change; a longer stale time avoids needless refetching. */
const REPORT_STALE_TIME = 2 * 60_000;

const key = (tenantId: string, name: string, from: string, to: string) =>
  ['tenant', tenantId, 'reports', name, from, to] as const;

/**
 * Everything the reports screen needs, in one hook.
 *
 * The six queries run in parallel rather than in sequence: they are independent
 * aggregates over the same range, so the screen is only as slow as the slowest
 * one instead of the sum of all six.
 *
 * Each `queryFn` closes over plain strings that also appear in its key. That is
 * not stylistic - a key that omits something the function reads produces a
 * cache entry serving the wrong period's numbers, which is exactly the kind of
 * bug nobody notices until an owner queries their own figures.
 */
export function useReports(tenantId: string | null, range: DateRange) {
  const enabled = tenantId !== null;
  const id = tenantId ?? '';
  const { from, to } = range;
  const { from: prevFrom, to: prevTo } = previousRange(range);

  const results = useQueries({
    queries: [
      {
        queryKey: key(id, 'summary', from, to),
        queryFn: () => fetchRevenueSummary({ tenantId: id, from, to }),
        enabled,
        staleTime: REPORT_STALE_TIME,
      },
      {
        queryKey: key(id, 'daily', from, to),
        queryFn: () => fetchDailyRevenue({ tenantId: id, from, to }),
        enabled,
        staleTime: REPORT_STALE_TIME,
      },
      {
        queryKey: key(id, 'tables', from, to),
        queryFn: () => fetchTablePerformance({ tenantId: id, from, to }),
        enabled,
        staleTime: REPORT_STALE_TIME,
      },
      {
        queryKey: key(id, 'products', from, to),
        queryFn: () => fetchProductSales({ tenantId: id, from, to }),
        enabled,
        staleTime: REPORT_STALE_TIME,
      },
      {
        queryKey: key(id, 'expenses', from, to),
        queryFn: () => fetchExpenseBreakdown({ tenantId: id, from, to }),
        enabled,
        staleTime: REPORT_STALE_TIME,
      },
      {
        // The same period immediately before, so the screen can show whether
        // the club is up or down rather than a number in isolation.
        queryKey: key(id, 'summary', prevFrom, prevTo),
        queryFn: () => fetchRevenueSummary({ tenantId: id, from: prevFrom, to: prevTo }),
        enabled,
        staleTime: REPORT_STALE_TIME,
      },
    ],
  });

  const [summary, daily, tables, products, expenses, previous] = results;

  return {
    summary: summary?.data ?? null,
    daily: daily?.data ?? [],
    tables: tables?.data ?? [],
    products: products?.data ?? [],
    expenses: expenses?.data ?? [],
    previousSummary: previous?.data ?? null,
    isPending: results.some((r) => r.isPending),
    isError: results.some((r) => r.isError),
    error: results.find((r) => r.isError)?.error ?? null,
    isRefetching: results.some((r) => r.isRefetching),
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  };
}

export function useOutstandingSessions(tenantId: string | null) {
  const id = tenantId ?? 'none';
  return useQuery({
    queryKey: ['tenant', id, 'reports', 'outstanding'] as const,
    queryFn: () => fetchOutstandingSessions(id),
    enabled: tenantId !== null,
    staleTime: 60_000,
  });
}
