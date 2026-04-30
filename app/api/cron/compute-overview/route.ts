import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { upsertUniverseData } from '@/lib/universe';
import customerData from '@/data/customer_company.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max for Vercel

// ============================================================================
// Configuration
// ============================================================================

const UNIT_API_URL = process.env.UNIT_API_URL || 'https://api.s.unit.sh';
const UNIT_API_TOKEN = process.env.UNIT_API_TOKEN || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

const UNIT_HEADERS: HeadersInit = {
  'Authorization': `Bearer ${UNIT_API_TOKEN}`,
  'Content-Type': 'application/vnd.api+json',
};

type CustomerMapping = Record<string, string>;

// ============================================================================
// Types
// ============================================================================

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

interface UnitApiResponse {
  data: ReceivedPayment[];
  meta?: {
    pagination?: {
      total: number;
      limit: number;
      offset: number;
    };
  };
}

interface EmployerResult {
  employer_name: string;
  worker_count: number;
  prev_year_same_period: number;
  curr_year_total: number;
  prev_year_full: number;
  yoy_change_percent: number;
  trend: string;
  computed_at: string;
}

// ============================================================================
// Payment Filtering
// ============================================================================

const MIN_AMOUNT_CENTS = 500;

function shouldExcludePayment(payment: ReceivedPayment): boolean {
  const { amount, companyName, description } = payment.attributes;
  const co = (companyName || '').toUpperCase().trim();
  const desc = (description || '').toUpperCase().trim();

  if (amount < MIN_AMOUNT_CENTS) return true;

  if (co.startsWith('IRS TREAS') || co.startsWith('IRS ')) return true;
  if (co.startsWith('TAX REFUND')) return true;
  if (co.startsWith('STATE OF ')) return true;
  if (co.startsWith('SC STATE TREAS')) return true;
  if (co.startsWith('MS TAX COMMISS')) return true;
  if (co === 'TURBOTAX' || co.startsWith('TURBOTAX ')) return true;
  if (co === 'SBTPG' || co.startsWith('SBTPG ')) return true;

  if (desc.includes('TAX REF') || desc.includes('TAXRFD') || desc.includes('RFND DISB')) return true;
  if (desc.includes('IRS REFUND') || desc.includes('USATAXPYMT')) return true;

  if (/^#[A-Z0-9]{2,4}\s+RIA/.test(co)) return true;
  if (co === 'XOOM' || co.startsWith('XOOM ')) return true;
  if (co === 'VIAMERICAS' || co.startsWith('VIAMERICAS ')) return true;

  if (co === 'PAYPAL' || co.startsWith('PAYPAL ')) return true;
  if (co === 'VENMO' || co.startsWith('VENMO ')) return true;
  if (co === 'CASH APP' || co.startsWith('CASH APP ')) return true;
  if (desc === 'ZELLE' || desc.startsWith('ZELLE ') || co === 'ZELLE') return true;

  if (desc === 'ACCTVERIFY' || desc.startsWith('ACCTVERIFY')) return true;

  return false;
}

// ============================================================================
// Week Calculation
// ============================================================================

function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

function getUniqueAccountsByWeek(payments: ReceivedPayment[], year: number): Map<number, Set<string>> {
  const weekAccounts = new Map<number, Set<string>>();
  payments.forEach(payment => {
    const dateStr = payment.attributes.completionDate || payment.attributes.createdAt;
    const date = new Date(dateStr);
    if (date.getFullYear() === year) {
      const weekNumber = getWeekNumber(date);
      if (!weekAccounts.has(weekNumber)) {
        weekAccounts.set(weekNumber, new Set());
      }
      weekAccounts.get(weekNumber)!.add(payment.relationships.account.data.id);
    }
  });
  return weekAccounts;
}

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
  payments.forEach(payment => {
    uniqueAccounts.add(payment.relationships.account.data.id);
  });
  return uniqueAccounts.size;
}

function getTrend(yoyChange: number): string {
  if (yoyChange > 10) return 'Strong Growth';
  if (yoyChange > 0) return 'Growing';
  if (yoyChange === 0) return 'Stable';
  if (yoyChange > -10) return 'Slight Decline';
  return 'Significant Decline';
}

// ============================================================================
// API Fetching — Org-wide
// ============================================================================

async function fetchAllOrgPayments(
  since: string,
  until: string,
): Promise<ReceivedPayment[]> {
  const allPayments: ReceivedPayment[] = [];
  let offset = 0;
  const limit = 1000;
  let totalRecords: number | null = null;

  while (true) {
    const params = new URLSearchParams({
      'filter[since]': since,
      'filter[until]': until,
      'filter[includeCompleted]': 'true',
      'page[limit]': limit.toString(),
      'page[offset]': offset.toString(),
    });

    const response = await fetch(`${UNIT_API_URL}/received-payments?${params}`, {
      headers: UNIT_HEADERS,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Unit API error ${response.status}: ${errorText}`);
    }

    const data: UnitApiResponse = await response.json();
    allPayments.push(...data.data);

    if (totalRecords === null && data.meta?.pagination?.total !== undefined) {
      totalRecords = data.meta.pagination.total;
    }

    if (totalRecords !== null) {
      if (offset + limit >= totalRecords) break;
    } else {
      if (data.data.length < limit) break;
    }

    offset += limit;
    await new Promise(r => setTimeout(r, 50));
  }

  return allPayments;
}

// ============================================================================
// Main Computation
// ============================================================================

interface ComputeResult {
  employers: EmployerResult[];
  prevFiltered: ReceivedPayment[];
  currFiltered: ReceivedPayment[];
  previousYear: number;
  currentYear: number;
  lastCompleteWeek: number;
  totalWorkers: number;
  totalEmployers: number;
}

async function computeAllEmployers(): Promise<ComputeResult> {
  const mapping = customerData as CustomerMapping;

  // Build employer groups
  const employerGroups = new Map<string, string[]>();
  for (const [customerId, employerName] of Object.entries(mapping)) {
    if (!employerGroups.has(employerName)) {
      employerGroups.set(employerName, []);
    }
    employerGroups.get(employerName)!.push(customerId);
  }

  const employers = Array.from(employerGroups.entries());

  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  const currentWeek = getWeekNumber(new Date());
  const lastCompleteWeek = Math.max(currentWeek - 1, 1);

  const prevYearStart = `${previousYear}-01-01T00:00:00.000Z`;
  const prevYearEnd = `${previousYear}-12-31T23:59:59.999Z`;
  const currYearStart = `${currentYear}-01-01T00:00:00.000Z`;
  const today = new Date().toISOString();

  console.log(`[Cron] Fetching ${previousYear} payments...`);
  const allPrevPayments = await fetchAllOrgPayments(prevYearStart, prevYearEnd);
  console.log(`[Cron] Fetched ${allPrevPayments.length} payments for ${previousYear}`);

  console.log(`[Cron] Fetching ${currentYear} payments...`);
  const allCurrPayments = await fetchAllOrgPayments(currYearStart, today);
  console.log(`[Cron] Fetched ${allCurrPayments.length} payments for ${currentYear}`);

  // Filter non-payroll
  const prevFiltered = allPrevPayments.filter(p => !shouldExcludePayment(p));
  const currFiltered = allCurrPayments.filter(p => !shouldExcludePayment(p));

  console.log(`[Cron] After filtering: ${prevFiltered.length} (${previousYear}), ${currFiltered.length} (${currentYear})`);

  // Build lookup: customerId → payments
  const prevByCustomer = new Map<string, ReceivedPayment[]>();
  for (const p of prevFiltered) {
    const cid = p.relationships.customer.data.id;
    if (!prevByCustomer.has(cid)) prevByCustomer.set(cid, []);
    prevByCustomer.get(cid)!.push(p);
  }
  const currByCustomer = new Map<string, ReceivedPayment[]>();
  for (const p of currFiltered) {
    const cid = p.relationships.customer.data.id;
    if (!currByCustomer.has(cid)) currByCustomer.set(cid, []);
    currByCustomer.get(cid)!.push(p);
  }

  // Compute per-employer metrics
  const results: EmployerResult[] = [];

  for (const [employerName, customerIds] of employers) {
    const prevPayments: ReceivedPayment[] = [];
    const currPayments: ReceivedPayment[] = [];
    for (const cid of customerIds) {
      prevPayments.push(...(prevByCustomer.get(cid) || []));
      currPayments.push(...(currByCustomer.get(cid) || []));
    }

    const prevByWeek = getUniqueAccountsByWeek(prevPayments, previousYear);
    const prevSamePeriod = countUniqueAccountsUpToWeek(prevByWeek, lastCompleteWeek);
    const currTotal = countTotalUniqueAccounts(currPayments);
    const prevTotal = countTotalUniqueAccounts(prevPayments);

    const yoyChange = prevSamePeriod > 0
      ? ((currTotal - prevSamePeriod) / prevSamePeriod * 100)
      : (currTotal > 0 ? 100 : 0);

    results.push({
      employer_name: employerName,
      worker_count: customerIds.length,
      prev_year_same_period: prevSamePeriod,
      curr_year_total: currTotal,
      prev_year_full: prevTotal,
      yoy_change_percent: Math.round(yoyChange * 100) / 100,
      trend: getTrend(yoyChange),
      computed_at: new Date().toISOString(),
    });
  }

  return {
    employers: results,
    prevFiltered,
    currFiltered,
    previousYear,
    currentYear,
    lastCompleteWeek,
    totalWorkers: Object.keys(mapping).length,
    totalEmployers: employers.length,
  };
}

// ============================================================================
// Cron Handler
// ============================================================================

export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized invocations
  const authHeader = request.headers.get('authorization');
  
  // Allow both Vercel cron (no auth needed from their side) and manual with secret
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    // Check for Vercel's cron header as alternative
    const vercelCron = request.headers.get('x-vercel-cron');
    if (!vercelCron) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!UNIT_API_TOKEN) {
    return NextResponse.json({ error: 'UNIT_API_TOKEN not configured' }, { status: 500 });
  }

  const startTime = Date.now();

  try {
    console.log('[Cron] Starting overview computation...');
    const {
      employers: results,
      prevFiltered,
      currFiltered,
      previousYear,
      currentYear,
      lastCompleteWeek,
      totalWorkers,
      totalEmployers,
    } = await computeAllEmployers();

    // Save per-employer data to Supabase in batches
    console.log(`[Cron] Saving ${results.length} employers to Supabase...`);
    for (let i = 0; i < results.length; i += 50) {
      const batch = results.slice(i, i + 50);
      const { error } = await getSupabase()
        .from('employer_overview')
        .upsert(batch, { onConflict: 'employer_name' });

      if (error) {
        console.error('[Cron] Supabase upsert error:', error);
        throw new Error(`Database error: ${error.message}`);
      }
    }

    // Save universe-wide aggregation
    console.log('[Cron] Computing universe-wide aggregation...');
    await upsertUniverseData(
      prevFiltered,
      currFiltered,
      previousYear,
      currentYear,
      lastCompleteWeek,
      totalWorkers,
      totalEmployers,
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Cron] Completed in ${duration}s — ${results.length} employers + universe updated`);

    return NextResponse.json({
      success: true,
      message: `Computed metrics for ${results.length} employers + universe summary`,
      duration: `${duration}s`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Computation failed' },
      { status: 500 },
    );
  }
}
