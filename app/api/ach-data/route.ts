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
// PAYROLL FILTERING LOGIC
// ============================================================================

/**
 * Known non-payroll company names to exclude
 * Add more as you identify them in your data
 */
const EXCLUDED_COMPANY_NAMES = [
  // Tax refunds
  'IRS', 'TREAS', 'TREASURY', 'TAX REFUND', 'STATE TAX', 'FRANCHISE TAX',
  // Bank verification / micro-deposits
  'PLAID', 'STRIPE', 'VERIFY', 'VERIFICATION', 'MICRO', 'TEST',
  // Government benefits (not employer payroll)
  'SSA', 'SOCIAL SECURITY', 'SSI', 'DISABILITY',
  // Other non-payroll
  'VENMO', 'PAYPAL', 'CASH APP', 'ZELLE',
];

/**
 * Keywords that indicate payroll payments (positive signals)
 */
const PAYROLL_KEYWORDS = [
  'PAYROLL', 'PAYROL', 'PAY ROLL',
  'DIRECT DEP', 'DIR DEP', 'DIRECT DEPOSIT',
  'SALARY', 'WAGES', 'WAGE',
  'PAYCHEX', 'ADP', 'GUSTO', 'QUICKBOOKS', 'INTUIT',
  'EMPLOYEE', 'EMP PAY',
];

/**
 * Keywords that indicate NON-payroll payments (negative signals)
 */
const NON_PAYROLL_KEYWORDS = [
  'TAX REFUND', 'REFUND', 'TAX REF',
  'VERIFICATION', 'VERIFY', 'MICRO DEPOSIT',
  'TRANSFER', 'XFER',
  'BENEFIT', 'SSA', 'SSI',
  'REBATE', 'REWARD', 'BONUS OFFER',
  'INTEREST', 'DIVIDEND',
];

/**
 * Minimum amount threshold (in cents) - filters out micro-deposits
 * $5.00 = 500 cents
 */
const MIN_PAYROLL_AMOUNT_CENTS = 500;

/**
 * Maximum reasonable payroll amount (in cents) - filters out unusual large transfers
 * $50,000 = 5,000,000 cents
 */
const MAX_PAYROLL_AMOUNT_CENTS = 5000000;

/**
 * Determines if a received ACH payment is likely a payroll payment
 */
function isLikelyPayrollPayment(payment: ReceivedPayment): boolean {
  const { amount, companyName, description, secCode } = payment.attributes;
  
  // 1. Amount filters - exclude micro-deposits and unusually large transfers
  if (amount < MIN_PAYROLL_AMOUNT_CENTS || amount > MAX_PAYROLL_AMOUNT_CENTS) {
    return false;
  }
  
  // 2. SEC Code filter - PPD (Prearranged Payment and Deposit) is typical for payroll
  // CCD is for business-to-business, which could also be payroll
  // Exclude WEB (web-initiated) which is often person-to-person
  if (secCode) {
    const code = secCode.toUpperCase();
    // WEB transactions are usually not payroll
    if (code === 'WEB') {
      return false;
    }
    // PPD is the standard payroll SEC code - strong positive signal
    if (code === 'PPD') {
      // Continue with other checks but this is a good sign
    }
  }
  
  // 3. Check company name against exclusion list
  if (companyName) {
    const upperCompany = companyName.toUpperCase();
    for (const excluded of EXCLUDED_COMPANY_NAMES) {
      if (upperCompany.includes(excluded)) {
        return false;
      }
    }
  }
  
  // 4. Check description for non-payroll keywords
  const upperDescription = (description || '').toUpperCase();
  const upperCompanyName = (companyName || '').toUpperCase();
  const combinedText = `${upperDescription} ${upperCompanyName}`;
  
  for (const keyword of NON_PAYROLL_KEYWORDS) {
    if (combinedText.includes(keyword)) {
      return false;
    }
  }
  
  // 5. Positive signal: Check for payroll keywords
  // If we find payroll keywords, definitely include it
  for (const keyword of PAYROLL_KEYWORDS) {
    if (combinedText.includes(keyword)) {
      return true;
    }
  }
  
  // 6. Default: If amount is reasonable and no red flags, include it
  // Most employer payroll ACHs won't explicitly say "PAYROLL" but will be
  // regular recurring payments from the same company
  // A reasonable payroll amount range: $50 - $10,000 per payment
  if (amount >= 5000 && amount <= 1000000) {
    return true;
  }
  
  // 7. Small amounts ($5-$50) without payroll keywords are suspicious
  // Could be verification deposits
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
 * Fetches all received payments from Unit API for a single customer with pagination
 */
async function fetchReceivedPaymentsForCustomer(
  customerId: string,
  since: string,
  until: string
): Promise<ReceivedPayment[]> {
  if (!UNIT_API_TOKEN) {
    throw new Error('UNIT_API_TOKEN not configured');
  }

  const allPayments: ReceivedPayment[] = [];
  let offset = 0;
  const limit = 1000;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      'filter[customerId]': customerId,
      'filter[since]': since,
      'filter[until]': until,
      'filter[status][]': 'Completed',
      'filter[includeCompleted]': 'true',
      'page[limit]': limit.toString(),
      'page[offset]': offset.toString(),
    });

    const response = await fetch(`${UNIT_API_URL}/received-payments?${params}`, {
      headers: {
        'Authorization': `Bearer ${UNIT_API_TOKEN}`,
        'Content-Type': 'application/vnd.api+json',
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Unit API Error for customer ${customerId}:`, response.status, errorText);
      break;
    }

    const data: UnitApiResponse = await response.json();
    allPayments.push(...data.data);

    const total = data.meta?.pagination?.total || data.data.length;
    offset += limit;
    hasMore = offset < total && data.data.length === limit;
  }

  return allPayments;
}

/**
 * Fetches all received payments for ALL customers belonging to an employer
 * and filters to only include likely payroll payments
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

  const allPayments: ReceivedPayment[] = [];
  const batchSize = 10;
  
  for (let i = 0; i < customerIds.length; i += batchSize) {
    const batch = customerIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(customerId => fetchReceivedPaymentsForCustomer(customerId, since, until))
    );
    
    for (const payments of batchResults) {
      allPayments.push(...payments);
    }
  }

  // Filter to only payroll payments
  const payrollPayments = allPayments.filter(isLikelyPayrollPayment);
  
  console.log(`[${employerName}] Total ACHs: ${allPayments.length}, Payroll ACHs: ${payrollPayments.length}`);
  
  return payrollPayments;
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
    
    // Fetch and filter payroll payments only
    const prevYearPayments = await fetchPayrollPaymentsForEmployer(
      employerName,
      `${previousYear}-01-01`,
      `${previousYear}-12-31`
    );
    
    const today = new Date().toISOString().split('T')[0];
    const currYearPayments = await fetchPayrollPaymentsForEmployer(
      employerName,
      `${currentYear}-01-01`,
      today
    );

    const prevYearByWeek = aggregateByWeek(prevYearPayments, previousYear);
    const currYearByWeek = aggregateByWeek(currYearPayments, currentYear);

    const chartData: WeeklyData[] = [];

    for (let week = 1; week <= 52; week++) {
      chartData.push({
        week: `Week ${week}`,
        weekNum: week,
        year2025: prevYearByWeek.get(week) || 0,
        year2026: week <= currentWeek ? (currYearByWeek.get(week) || 0) : null,
      });
    }

    const prevYearSamePeriod = countPaymentsUpToWeek(prevYearByWeek, currentWeek);
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
