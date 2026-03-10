import { getSupabase } from '@/lib/supabase';
import customerData from '@/data/customer_company.json';

export const dynamic = 'force-dynamic';

// ============================================================================
// Configuration
// ============================================================================

const UNIT_API_URL = process.env.UNIT_API_URL || 'https://api.s.unit.sh';
const UNIT_API_TOKEN = process.env.UNIT_API_TOKEN || '';

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
// Payment Filtering (same logic as ach-data route)
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

function aggregateByWeek(payments: ReceivedPayment[], year: number): Map<number, number> {
  const weekCounts = new Map<number, number>();
  payments.forEach(payment => {
    const dateStr = payment.attributes.completionDate || payment.attributes.createdAt;
    const date = new Date(dateStr);
    if (date.getFullYear() === year) {
      const weekNumber = getWeekNumber(date);
      weekCounts.set(weekNumber, (weekCounts.get(weekNumber) || 0) + 1);
    }
  });
  return weekCounts;
}

function countPaymentsUpToWeek(weekCounts: Map<number, number>, maxWeek: number): number {
  let total = 0;
  for (let week = 1; week <= maxWeek; week++) {
    total += weekCounts.get(week) || 0;
  }
  return total;
}

function getTrend(yoyChange: number): string {
  if (yoyChange > 10) return 'Strong Growth';
  if (yoyChange > 0) return 'Growing';
  if (yoyChange === 0) return 'Stable';
  if (yoyChange > -10) return 'Slight Decline';
  return 'Significant Decline';
}

// ============================================================================
// API Fetching — Org-wide (fast path)
// ============================================================================

/**
 * Fetches ALL received payments for a date range across the entire org.
 * Does NOT use filter[includeCompleted] to avoid 400 errors.
 * Paginates carefully, respecting API limits.
 */
async function fetchAllOrgPayments(
  since: string,
  until: string,
  sendProgress: (msg: string, pct: number) => Promise<void>,
  baseProgress: number,
  progressRange: number,
): Promise<ReceivedPayment[]> {
  const allPayments: ReceivedPayment[] = [];
  let offset = 0;
  const limit = 1000;
  let totalRecords: number | null = null;

  while (true) {
    const params = new URLSearchParams({
      'filter[since]': since,
      'filter[until]': until,
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

    // Capture total from first response
    if (totalRecords === null && data.meta?.pagination?.total !== undefined) {
      totalRecords = data.meta.pagination.total;
    }

    // Calculate progress
    const pct = totalRecords
      ? baseProgress + progressRange * Math.min(allPayments.length / totalRecords, 1)
      : baseProgress + progressRange * 0.5;
    await sendProgress(
      `Fetched ${allPayments.length.toLocaleString()}${totalRecords ? ` of ${totalRecords.toLocaleString()}` : ''} payments...`,
      pct,
    );

    // Pagination termination
    if (totalRecords !== null) {
      if (offset + limit >= totalRecords) break;
    } else {
      // No total in response — stop if we got fewer records than the limit
      if (data.data.length < limit) break;
    }

    offset += limit;

    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 50));
  }

  return allPayments;
}

// ============================================================================
// API Fetching — Per-employer fallback (slow path)
// ============================================================================

/**
 * Fetches payments for a list of customer IDs, batching to avoid overwhelming the API.
 * Returns all payments across all customers in the list.
 */
async function fetchPaymentsForCustomers(
  customerIds: string[],
  since: string,
  until: string,
): Promise<ReceivedPayment[]> {
  const allPayments: ReceivedPayment[] = [];
  const batchSize = 10;

  for (let i = 0; i < customerIds.length; i += batchSize) {
    const batch = customerIds.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(cid => fetchPaymentsForCustomer(cid, since, until)),
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        allPayments.push(...result.value);
      }
      // Rejected results are silently skipped (logged in fetchPaymentsForCustomer)
    }

    // Rate limiting delay between batches
    if (i + batchSize < customerIds.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return allPayments;
}

/**
 * Fetches all received payments for a single customer ID with careful pagination.
 * Does NOT use filter[includeCompleted] to avoid the 400 "status + includeCompleted" conflict.
 */
async function fetchPaymentsForCustomer(
  customerId: string,
  since: string,
  until: string,
): Promise<ReceivedPayment[]> {
  const allPayments: ReceivedPayment[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const params = new URLSearchParams({
      'filter[customerId]': customerId,
      'filter[since]': since,
      'filter[until]': until,
      'page[limit]': limit.toString(),
      'page[offset]': offset.toString(),
    });

    let response: Response;
    try {
      response = await fetch(`${UNIT_API_URL}/received-payments?${params}`, {
        headers: UNIT_HEADERS,
      });
    } catch (err) {
      console.error(`Network error for customer ${customerId}:`, err);
      break;
    }

    if (!response.ok) {
      // Log but don't throw — skip this customer gracefully
      console.error(`Unit API error for customer ${customerId}: ${response.status}`);
      break;
    }

    let data: UnitApiResponse;
    try {
      data = await response.json();
    } catch {
      console.error(`JSON parse error for customer ${customerId}`);
      break;
    }

    allPayments.push(...data.data);

    // Pagination termination
    const total = data.meta?.pagination?.total;
    if (total !== undefined) {
      if (offset + limit >= total) break;
    } else {
      if (data.data.length < limit) break;
    }

    offset += limit;
  }

  return allPayments;
}

// ============================================================================
// Main Computation
// ============================================================================

async function computeAllEmployers(
  sendProgress: (msg: string, pct: number) => Promise<void>,
): Promise<EmployerResult[]> {
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
  const totalEmployers = employers.length;

  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  const currentWeek = getWeekNumber(new Date());
  const lastCompleteWeek = Math.max(currentWeek - 1, 1);

  const prevYearStart = `${previousYear}-01-01T00:00:00.000Z`;
  const prevYearEnd = `${previousYear}-12-31T23:59:59.999Z`;
  const currYearStart = `${currentYear}-01-01T00:00:00.000Z`;
  const today = new Date().toISOString();

  // ------------------------------------------------------------------
  // Strategy 1: Org-wide fetch (fast — ~100-200 API calls total)
  // ------------------------------------------------------------------
  let allPrevPayments: ReceivedPayment[] | null = null;
  let allCurrPayments: ReceivedPayment[] | null = null;

  try {
    await sendProgress(`Fetching all ${previousYear} payments (org-wide)...`, 2);
    allPrevPayments = await fetchAllOrgPayments(prevYearStart, prevYearEnd, sendProgress, 2, 23);

    await sendProgress(`Fetching all ${currentYear} payments (org-wide)...`, 27);
    allCurrPayments = await fetchAllOrgPayments(currYearStart, today, sendProgress, 27, 23);

    await sendProgress(
      `Org-wide fetch complete: ${allPrevPayments.length.toLocaleString()} (${previousYear}) + ${allCurrPayments.length.toLocaleString()} (${currentYear}) payments`,
      52,
    );
  } catch (err) {
    console.warn('Org-wide fetch failed, falling back to per-employer:', err);
    allPrevPayments = null;
    allCurrPayments = null;
    await sendProgress('Org-wide fetch not available — switching to per-employer mode...', 5);
  }

  // ------------------------------------------------------------------
  // Process results
  // ------------------------------------------------------------------
  const results: EmployerResult[] = [];

  if (allPrevPayments !== null && allCurrPayments !== null) {
    // ---- FAST PATH: aggregate in memory ----
    await sendProgress('Filtering non-payroll payments...', 55);
    const prevFiltered = allPrevPayments.filter(p => !shouldExcludePayment(p));
    const currFiltered = allCurrPayments.filter(p => !shouldExcludePayment(p));

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

    await sendProgress('Computing employer metrics...', 60);

    for (let i = 0; i < employers.length; i++) {
      const [employerName, customerIds] = employers[i];

      // Gather payments for this employer's customers
      const prevPayments: ReceivedPayment[] = [];
      const currPayments: ReceivedPayment[] = [];
      for (const cid of customerIds) {
        prevPayments.push(...(prevByCustomer.get(cid) || []));
        currPayments.push(...(currByCustomer.get(cid) || []));
      }

      const prevByWeek = aggregateByWeek(prevPayments, previousYear);
      const prevSamePeriod = countPaymentsUpToWeek(prevByWeek, lastCompleteWeek);

      const yoyChange = prevSamePeriod > 0
        ? ((currPayments.length - prevSamePeriod) / prevSamePeriod * 100)
        : (currPayments.length > 0 ? 100 : 0);

      results.push({
        employer_name: employerName,
        worker_count: customerIds.length,
        prev_year_same_period: prevSamePeriod,
        curr_year_total: currPayments.length,
        prev_year_full: prevPayments.length,
        yoy_change_percent: Math.round(yoyChange * 100) / 100,
        trend: getTrend(yoyChange),
        computed_at: new Date().toISOString(),
      });

      if (i % 20 === 0) {
        await sendProgress(
          `Computed ${i + 1} of ${totalEmployers} employers...`,
          60 + 25 * ((i + 1) / totalEmployers),
        );
      }
    }
  } else {
    // ---- SLOW PATH: per-employer fetch ----
    for (let i = 0; i < employers.length; i++) {
      const [employerName, customerIds] = employers[i];
      const pct = 5 + 80 * (i / totalEmployers);

      await sendProgress(
        `Processing ${employerName} (${i + 1}/${totalEmployers}) — ${customerIds.length} workers...`,
        pct,
      );

      try {
        const prevPayments = await fetchPaymentsForCustomers(customerIds, prevYearStart, prevYearEnd);
        const currPayments = await fetchPaymentsForCustomers(customerIds, currYearStart, today);

        const prevFiltered = prevPayments.filter(p => !shouldExcludePayment(p));
        const currFiltered = currPayments.filter(p => !shouldExcludePayment(p));

        const prevByWeek = aggregateByWeek(prevFiltered, previousYear);
        const prevSamePeriod = countPaymentsUpToWeek(prevByWeek, lastCompleteWeek);

        const yoyChange = prevSamePeriod > 0
          ? ((currFiltered.length - prevSamePeriod) / prevSamePeriod * 100)
          : (currFiltered.length > 0 ? 100 : 0);

        const result: EmployerResult = {
          employer_name: employerName,
          worker_count: customerIds.length,
          prev_year_same_period: prevSamePeriod,
          curr_year_total: currFiltered.length,
          prev_year_full: prevFiltered.length,
          yoy_change_percent: Math.round(yoyChange * 100) / 100,
          trend: getTrend(yoyChange),
          computed_at: new Date().toISOString(),
        };

        results.push(result);

        // Upsert immediately so partial progress is saved even if we time out
        await getSupabase()
          .from('employer_overview')
          .upsert(result, { onConflict: 'employer_name' });
      } catch (err) {
        console.error(`Error processing ${employerName}:`, err);
        // Continue — don't let one employer break the whole run
      }
    }
  }

  // ------------------------------------------------------------------
  // Save all results to Supabase
  // ------------------------------------------------------------------
  await sendProgress(`Saving ${results.length} employers to database...`, 88);

  // Upsert in batches of 50 to avoid payload limits
  for (let i = 0; i < results.length; i += 50) {
    const batch = results.slice(i, i + 50);
    const { error } = await getSupabase()
      .from('employer_overview')
      .upsert(batch, { onConflict: 'employer_name' });

    if (error) {
      console.error('Supabase upsert error:', error);
      throw new Error(`Database error: ${error.message}`);
    }
  }

  return results;
}

// ============================================================================
// API Handler — Streaming SSE Response
// ============================================================================

export async function POST() {
  if (!UNIT_API_TOKEN) {
    return new Response(JSON.stringify({ error: 'UNIT_API_TOKEN not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendEvent = async (data: Record<string, unknown>) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      // Stream may have been closed by the client
    }
  };

  // Run computation in the background while streaming progress
  (async () => {
    try {
      const sendProgress = async (message: string, progress: number) => {
        await sendEvent({ type: 'progress', message, progress: Math.round(progress) });
      };

      await sendProgress('Starting overview computation...', 0);

      const results = await computeAllEmployers(sendProgress);

      await sendEvent({
        type: 'complete',
        message: `Successfully computed metrics for ${results.length} employers`,
        progress: 100,
        employerCount: results.length,
      });
    } catch (err) {
      console.error('Compute error:', err);
      await sendEvent({
        type: 'error',
        message: err instanceof Error ? err.message : 'Computation failed',
      });
    } finally {
      try {
        await writer.close();
      } catch {
        // Already closed
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
