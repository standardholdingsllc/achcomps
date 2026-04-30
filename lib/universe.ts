import { getSupabase } from '@/lib/supabase';

interface ReceivedPayment {
  id: string;
  type: string;
  attributes: {
    createdAt: string;
    completionDate?: string;
    amount: number;
    status: string;
    companyName?: string;
    description?: string;
    secCode?: string;
  };
  relationships: {
    customer: { data: { type: string; id: string } };
    account: { data: { type: string; id: string } };
  };
}

function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

function getTrend(yoyChange: number): string {
  if (yoyChange > 10) return 'Strong Growth';
  if (yoyChange > 0) return 'Growing';
  if (yoyChange === 0) return 'Stable';
  if (yoyChange > -10) return 'Slight Decline';
  return 'Significant Decline';
}

/**
 * Counts unique account IDs per week for a given year.
 * Each week maps to the set of distinct account IDs that received at least one payment.
 */
function getUniqueAccountsByWeek(payments: ReceivedPayment[], year: number): Map<number, Set<string>> {
  const weekAccounts = new Map<number, Set<string>>();
  for (const payment of payments) {
    const dateStr = payment.attributes.completionDate || payment.attributes.createdAt;
    const date = new Date(dateStr);
    if (date.getFullYear() === year) {
      const weekNumber = getWeekNumber(date);
      if (!weekAccounts.has(weekNumber)) {
        weekAccounts.set(weekNumber, new Set());
      }
      weekAccounts.get(weekNumber)!.add(payment.relationships.account.data.id);
    }
  }
  return weekAccounts;
}

/**
 * Counts the total unique accounts across weeks 1..maxWeek (cumulative, deduped).
 */
function countUniqueAccountsUpToWeek(weekAccounts: Map<number, Set<string>>, maxWeek: number): number {
  const allAccounts = new Set<string>();
  for (let week = 1; week <= maxWeek; week++) {
    const accounts = weekAccounts.get(week);
    if (accounts) {
      accounts.forEach(acc => allAccounts.add(acc));
    }
  }
  return allAccounts.size;
}

function countTotalUniqueAccounts(payments: ReceivedPayment[]): number {
  const uniqueAccounts = new Set<string>();
  for (const payment of payments) {
    uniqueAccounts.add(payment.relationships.account.data.id);
  }
  return uniqueAccounts.size;
}

/**
 * Aggregates universe-wide metrics using unique ACH recipients (account IDs)
 * and upserts to universe_weekly_ach and universe_summary tables.
 *
 * Weekly chart values = number of unique accounts that received ACH that week.
 * Summary totals = cumulative unique accounts across all weeks (deduped).
 */
export async function upsertUniverseData(
  prevFiltered: ReceivedPayment[],
  currFiltered: ReceivedPayment[],
  previousYear: number,
  currentYear: number,
  lastCompleteWeek: number,
  totalWorkers: number,
  totalEmployers: number,
): Promise<void> {
  const prevByWeek = getUniqueAccountsByWeek(prevFiltered, previousYear);
  const currByWeek = getUniqueAccountsByWeek(currFiltered, currentYear);

  const now = new Date().toISOString();

  // Always write all 53 weeks for both years so stale rows are zeroed out
  const weeklyRows: { week_number: number; year: number; ach_count: number; computed_at: string }[] = [];
  for (let week = 1; week <= 53; week++) {
    weeklyRows.push({
      week_number: week,
      year: previousYear,
      ach_count: prevByWeek.get(week)?.size || 0,
      computed_at: now,
    });
    weeklyRows.push({
      week_number: week,
      year: currentYear,
      ach_count: currByWeek.get(week)?.size || 0,
      computed_at: now,
    });
  }

  for (let i = 0; i < weeklyRows.length; i += 50) {
    const batch = weeklyRows.slice(i, i + 50);
    const { error } = await getSupabase()
      .from('universe_weekly_ach')
      .upsert(batch, { onConflict: 'week_number,year' });

    if (error) {
      console.error('Universe weekly upsert error:', error);
      throw new Error(`Database error (universe_weekly_ach): ${error.message}`);
    }
  }

  const prevSamePeriod = countUniqueAccountsUpToWeek(prevByWeek, lastCompleteWeek);
  const currTotal = countTotalUniqueAccounts(currFiltered);
  const prevTotal = countTotalUniqueAccounts(prevFiltered);

  const yoyChange = prevSamePeriod > 0
    ? ((currTotal - prevSamePeriod) / prevSamePeriod * 100)
    : (currTotal > 0 ? 100 : 0);

  const summaryRow = {
    id: 'latest',
    prev_year_total: prevTotal,
    prev_year_same_period: prevSamePeriod,
    curr_year_total: currTotal,
    yoy_change_percent: Math.round(yoyChange * 100) / 100,
    trend: getTrend(yoyChange),
    total_workers: totalWorkers,
    total_employers: totalEmployers,
    previous_year: previousYear,
    current_year: currentYear,
    computed_at: now,
  };

  const { error: summaryError } = await getSupabase()
    .from('universe_summary')
    .upsert(summaryRow, { onConflict: 'id' });

  if (summaryError) {
    console.error('Universe summary upsert error:', summaryError);
    throw new Error(`Database error (universe_summary): ${summaryError.message}`);
  }
}
