import { NextResponse } from 'next/server';
import customerData from '@/data/customer_company.json';

export const dynamic = 'force-dynamic';

const UNIT_API_URL = process.env.UNIT_API_URL || 'https://api.s.unit.sh';
const UNIT_API_TOKEN = process.env.UNIT_API_TOKEN || '';

// The JSON structure is: { "customerId": "employerName", ... }
type CustomerMapping = Record<string, string>;

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

interface WeeklyData {
  week: string;
  weekNum: number;
  year2025: number;
  year2026: number | null;
}

// ============================================================================
// PAYMENT FILTERING LOGIC
// ============================================================================
// These are incoming ACH payments to seasonal workers. The vast majority are
// employer payroll deposits. We only need to strip out obvious non-payroll
// noise: IRS tax refunds, micro-deposits, remittance services, and P2P.
// ============================================================================

/**
 * Minimum amount (in cents) — $5. Filters out micro-deposits / account verification.
 */
const MIN_AMOUNT_CENTS = 500;

/**
 * Returns true if the payment should be EXCLUDED (is clearly not payroll).
 * Uses exact or very specific patterns to avoid false positives.
 */
function shouldExcludePayment(payment: ReceivedPayment): boolean {
  const { amount, companyName, description } = payment.attributes;
  const co = (companyName || '').toUpperCase().trim();
  const desc = (description || '').toUpperCase().trim();

  // 1. Skip tiny amounts (micro-deposits, account verification)
  if (amount < MIN_AMOUNT_CENTS) return true;

  // 2. IRS / state tax refunds — match company name exactly starting with these
  if (co.startsWith('IRS TREAS') || co.startsWith('IRS ')) return true;
  if (co.startsWith('TAX REFUND')) return true;
  if (co.startsWith('STATE OF ')) return true;              // STATE OF ARK, etc.
  if (co.startsWith('SC STATE TREAS')) return true;
  if (co.startsWith('MS TAX COMMISS')) return true;
  if (co === 'TURBOTAX' || co.startsWith('TURBOTAX ')) return true;
  if (co === 'SBTPG' || co.startsWith('SBTPG ')) return true;

  // 3. Tax-refund descriptions
  if (desc.includes('TAX REF') || desc.includes('TAXRFD') || desc.includes('RFND DISB')) return true;
  if (desc.includes('IRS REFUND') || desc.includes('USATAXPYMT')) return true;

  // 4. Remittance services — exact pattern #XXX RIA
  if (/^#[A-Z0-9]{2,4}\s+RIA/.test(co)) return true;
  if (co === 'XOOM' || co.startsWith('XOOM ')) return true;
  if (co === 'VIAMERICAS' || co.startsWith('VIAMERICAS ')) return true;

  // 5. P2P / consumer platforms
  if (co === 'PAYPAL' || co.startsWith('PAYPAL ')) return true;
  if (co === 'VENMO' || co.startsWith('VENMO ')) return true;
  if (co === 'CASH APP' || co.startsWith('CASH APP ')) return true;
  if (desc === 'ZELLE' || desc.startsWith('ZELLE ') || co === 'ZELLE') return true;

  // 6. Account verification micro-deposits
  if (desc === 'ACCTVERIFY' || desc.startsWith('ACCTVERIFY')) return true;

  return false;
}

// ============================================================================
// DATA FETCHING
// ============================================================================

/**
 * Get all customer IDs for a given employer name
 */
function getCustomerIdsForEmployer(employerName: string): string[] {
  const mapping = customerData as CustomerMapping;
  const customerIds: string[] = [];
  
  for (const [customerId, name] of Object.entries(mapping)) {
    if (name === employerName) {
      customerIds.push(customerId);
    }
  }
  
  return customerIds;
}

/**
 * Get employer name from customer ID
 */
function getEmployerName(customerId: string): string | null {
  const mapping = customerData as CustomerMapping;
  return mapping[customerId] || null;
}

/**
 * Fetches all received payments org-wide for a date range.
 * Uses filter[includeCompleted]=true to get both pending and completed payments.
 * This is the only reliable way to get historical completed payments from Unit API.
 */
async function fetchAllOrgPayments(
  since: string,
  until: string
): Promise<ReceivedPayment[]> {
  if (!UNIT_API_TOKEN) {
    throw new Error('UNIT_API_TOKEN not configured');
  }

  const allPayments: ReceivedPayment[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const params = new URLSearchParams({
      'filter[since]': since,
      'filter[until]': until,
      'filter[includeCompleted]': 'true',
      'page[limit]': limit.toString(),
      'page[offset]': offset.toString(),
    });

    const headers = {
      'Authorization': `Bearer ${UNIT_API_TOKEN}`,
      'Content-Type': 'application/vnd.api+json',
    };

    const response = await fetch(`${UNIT_API_URL}/received-payments?${params}`, {
      headers,
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Unit API error ${response.status}: ${errorText}`);
    }

    const data: UnitApiResponse = await response.json();
    allPayments.push(...data.data);

    // Reliable pagination termination
    const total = data.meta?.pagination?.total;
    if (total !== undefined) {
      if (offset + limit >= total) break;
    } else {
      if (data.data.length < limit) break;
    }
    offset += limit;

    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 50));
  }

  return allPayments;
}

/**
 * Fetches all received payments for an employer by:
 * 1. Fetching ALL org payments for the date range (with includeCompleted=true)
 * 2. Filtering to only payments belonging to this employer's customers
 * 3. Filtering out non-payroll noise
 */
async function fetchPayrollPaymentsForEmployer(
  employerName: string,
  since: string,
  until: string
): Promise<ReceivedPayment[]> {
  const customerIds = getCustomerIdsForEmployer(employerName);
  
  if (customerIds.length === 0) {
    return [];
  }

  // Create a Set for fast lookup
  const customerIdSet = new Set(customerIds);

  // Fetch all org payments for this date range
  const allOrgPayments = await fetchAllOrgPayments(since, until);
  
  // Debug: log sample customer IDs from payments vs what we're looking for
  const samplePaymentCids = allOrgPayments.slice(0, 5).map(p => p.relationships.customer.data.id);
  console.log(`[${employerName}] Looking for customer IDs: ${customerIds.slice(0, 5).join(', ')}...`);
  console.log(`[${employerName}] Sample payment customer IDs: ${samplePaymentCids.join(', ')}`);
  
  // Filter to only this employer's customers
  const employerPayments = allOrgPayments.filter(p => 
    customerIdSet.has(p.relationships.customer.data.id)
  );

  // Filter out obvious non-payroll noise (IRS, P2P, remittance, micro-deposits)
  const filteredPayments = employerPayments.filter(p => !shouldExcludePayment(p));
  
  // Log filtering stats for debugging
  const excluded = employerPayments.length - filteredPayments.length;
  console.log(`[${employerName}] Org total: ${allOrgPayments.length}, Employer: ${employerPayments.length}, Kept: ${filteredPayments.length}, Excluded: ${excluded}`);
  
  return filteredPayments;
}

// ============================================================================
// AGGREGATION
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

// ============================================================================
// API HANDLER
// ============================================================================

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get('customerId');
  const employerNameParam = searchParams.get('employer');
  
  let employerName: string | null = employerNameParam;
  
  if (!employerName && customerId) {
    employerName = getEmployerName(customerId);
  }
  
  if (!employerName) {
    return NextResponse.json({ error: 'employer or customerId is required' }, { status: 400 });
  }

  try {
    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;
    const currentWeek = getWeekNumber(new Date());
    
    // Unit API requires full ISO 8601 timestamps
    const prevYearStart = `${previousYear}-01-01T00:00:00.000Z`;
    const prevYearEnd = `${previousYear}-12-31T23:59:59.999Z`;
    const currYearStart = `${currentYear}-01-01T00:00:00.000Z`;
    const today = new Date().toISOString();
    
    // Fetch and filter payroll payments only
    const prevYearPayments = await fetchPayrollPaymentsForEmployer(
      employerName,
      prevYearStart,
      prevYearEnd
    );
    
    const currYearPayments = await fetchPayrollPaymentsForEmployer(
      employerName,
      currYearStart,
      today
    );

    const prevYearByWeek = aggregateByWeek(prevYearPayments, previousYear);
    const currYearByWeek = aggregateByWeek(currYearPayments, currentYear);

    const chartData: WeeklyData[] = [];

    // Only show completed weeks for current year (current week is incomplete/in-flight)
    const lastCompleteWeek = currentWeek - 1;

    for (let week = 1; week <= 52; week++) {
      chartData.push({
        week: `Week ${week}`,
        weekNum: week,
        year2025: prevYearByWeek.get(week) || 0,
        year2026: week <= lastCompleteWeek ? (currYearByWeek.get(week) || 0) : null,
      });
    }

    const prevYearSamePeriod = countPaymentsUpToWeek(prevYearByWeek, lastCompleteWeek);
    const workerCount = getCustomerIdsForEmployer(employerName).length;

    return NextResponse.json({
      chartData,
      summary: {
        employerName,
        workerCount,
        totalPrevYear: prevYearPayments.length,
        totalCurrYear: currYearPayments.length,
        prevYearSamePeriod,
        previousYear,
        currentYear,
        currentWeek,
      }
    });
  } catch (error) {
    console.error('Error fetching ACH data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch ACH data' },
      { status: 500 }
    );
  }
}
