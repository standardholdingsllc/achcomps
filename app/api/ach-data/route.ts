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
// PAYROLL FILTERING LOGIC - Based on real data analysis
// ============================================================================

/**
 * Company names that are DEFINITELY NOT employer payroll
 * These are exact matches or patterns found in real data
 */
const EXCLUDED_COMPANY_PATTERNS = [
  // Tax refunds - IRS and state
  'IRS TREAS',
  'IRS',
  'TAX REFUND',
  'STATE OF ',      // STATE OF ARK, STATE OF ALABAMA, STATE OF LA DEP
  'SC STATE TREAS', // SC STATE TREASUR
  'MS TAX COMMISS',
  'IASTTAXRFD',
  'TURBOTAX',
  
  // Remittance / Money transfer services (pattern: #XXX RIA)
  '#DHF RIA',
  '#FZF RIA', 
  '#DPJ RIA',
  '#PWG RIA',
  '#KTV RIA',
  '#JFK RIA',
  'RIA',           // Catch-all for remittance
  'XOOM',
  'VIAMERICAS',
  
  // P2P / Consumer payments
  'PAYPAL',
  'ZELLE',
  'VENMO',
  'CASH APP',
  
  // Banks / Financial services (not payroll)
  'CAPITAL ONE',
  'BANK OF AMERICA',
  'SYNOVUS BANK',
  'FICIBK',        // FICIBK CK WEBXFR
  
  // Insurance / Bills
  'VERIZON',
  'ATT',
  'AMEX EPAYMENT',
  'PROGRESSIVELEASE',
  'FALCON INSUR',
  'CREATIVE RISK',
  
  // Tax prep services
  'SBTPG',         // Santa Barbara Tax Products Group (tax refund processor)
  'DANDELION',
];

/**
 * Description patterns that indicate NON-payroll
 */
const EXCLUDED_DESCRIPTION_PATTERNS = [
  // Tax refunds
  'TAX REF',
  'TAX REFUND',
  'TAXRFD',        // Catches ARSTTAXRFD, GASTTAXRFD, LASTTAXRFD, IASTTAXRFD, MSSTTAXRFD
  'RFND DISB',
  'IRS REFUND',
  'USATAXPYMT',
  
  // Account verification (micro-deposits)
  'ACCTVERIFY',
  'VERIFY',
  
  // P2P / Transfers
  'P2P',
  'ZELLE',
  'TRANSFER',
  'MOBILE PMT',
  
  // Generic bill payments (not employer payroll)
  'BILL_PAY',
  'INSURANCE',
  'FLBLUE',        // Florida Blue insurance
];

/**
 * Description patterns that CONFIRM payroll
 * If description matches these, it's definitely payroll
 */
const PAYROLL_DESCRIPTION_PATTERNS = [
  'PAYROLL',
  'PAYROL',        // Catches ALVPAYROLL, 0PGPAYROLL, ALQPAYROLL, ALUPAYROLL, MCNEILLL PAYROLL
  'PAY',           // Generic but common for payroll
  'QUICKBOOKS',    // Payroll via QuickBooks
  'DIR DEP',       // Direct Deposit
  'DIRECT DEP',
];

/**
 * Company name patterns that CONFIRM payroll (known employers)
 * These are real employer names from the data
 */
const KNOWN_EMPLOYER_PATTERNS = [
  // Large employers from the data
  'SOUTHERNORCHMGMT',
  'JACKSON CITRUS',
  'PEARSON FARM',
  'FARM LABOR',
  'WILLIAMS',
  'MCNEILL',
  'LEDESMA',
  'CIRCLEH',
  'NORTH AMERICAN',
  'PATTERSON',
  'WOLF CREEK',
  'LEWIS NURSERY',
  'WISHON',
  'SUGAR MOUNT',
  'PAYROLL DEPOSIT',  // Generic payroll company name
  'EVERG',            // Evergreen companies
  'FRESHPIK',
  'JACKSONS FARMING',
  'SUPERIOR MIDWAY',
  'BOTTOMLEY',
  'SALES & SE',
  'APPALAC',
  'NORTH 40',
  'TULL HILL',
  'MERRI',
  'PIEDMONT',
  'REITHOFFER',
  'GOLD STAR',
  'SHARP FARMS',
  'H2A',              // H2A visa labor contractors
  'ADVANCED AGRICUL',
  'CRITCHER',
  'BOSEMAN FARMS',
  'CLINE CHURCH',
  'RIVER\'S EDGE',
  'AMUSEMENT',        // Carnival/amusement companies
  'PIERCE LEAF',
  'MCMAKIN',
  'BARBEE',
  'SOUTH CAROLINA G',
  'BARNES FARM',
  'BATTLEBORO',
  'RESONATE FOODS',
  'RAM NUTIENT',
  'BARR EVERGREEN',
  'BENEDICTS',
  'GROSS FARMS',
  'TRI-AIR',
  'HIGHLAND',
  'PUGHS',
  'TRIPLE H',
  'TNT',
  'BAILEY FARMS',
  'RIVER BEND',
  'DEGGELLER',
  'STEVE MITCHELL',
  'GUSTO',            // Gusto Payroll
  'SUMMIT FARMS',
  'ADAMS COUNTY',
  'BONNIE PLANTS',
  'MID-AMERICA',
  'SANDERSON',
  'WHITAKERS',
  'GREAT AMUSEMENT',
  'FUTURE PLASTER',
  'REPUBLIC TRS',     // Republic Services (could be payroll)
];

/**
 * Minimum amount for payroll (in cents) - $25
 * Filters out micro-deposits and very small payments
 */
const MIN_PAYROLL_AMOUNT_CENTS = 2500;

/**
 * Maximum reasonable payroll amount (in cents) - $15,000
 * Most individual payroll deposits won't exceed this
 */
const MAX_PAYROLL_AMOUNT_CENTS = 1500000;

/**
 * Determines if a received ACH payment is likely a payroll payment
 */
function isLikelyPayrollPayment(payment: ReceivedPayment): boolean {
  const { amount, companyName, description } = payment.attributes;
  
  const upperCompany = (companyName || '').toUpperCase().trim();
  const upperDescription = (description || '').toUpperCase().trim();
  
  // 1. Amount filter - must be reasonable payroll amount
  if (amount < MIN_PAYROLL_AMOUNT_CENTS || amount > MAX_PAYROLL_AMOUNT_CENTS) {
    return false;
  }
  
  // 2. Check description for EXCLUDED patterns (tax refunds, verification, P2P)
  for (const pattern of EXCLUDED_DESCRIPTION_PATTERNS) {
    if (upperDescription.includes(pattern)) {
      return false;
    }
  }
  
  // 3. Check company name for EXCLUDED patterns
  for (const pattern of EXCLUDED_COMPANY_PATTERNS) {
    if (upperCompany.includes(pattern.toUpperCase())) {
      return false;
    }
  }
  
  // 4. Check for RIA pattern (remittance services like #JFK RIA)
  if (upperCompany.match(/^#[A-Z]{2,4}\s+RIA$/)) {
    return false;
  }
  
  // 5. Check description for PAYROLL patterns - strong positive signal
  for (const pattern of PAYROLL_DESCRIPTION_PATTERNS) {
    if (upperDescription.includes(pattern)) {
      return true;
    }
  }
  
  // 6. Check company name for known employers - strong positive signal
  for (const pattern of KNOWN_EMPLOYER_PATTERNS) {
    if (upperCompany.includes(pattern.toUpperCase())) {
      return true;
    }
  }
  
  // 7. AchBatch description with reasonable amount is likely payroll
  // (SouthernOrchMgmt uses "AchBatch" as description)
  if (upperDescription === 'ACHBATCH' && amount >= 10000) {
    return true;
  }
  
  // 8. CONS PAY (consolidated pay) is likely payroll
  if (upperDescription === 'CONS PAY') {
    return true;
  }
  
  // 9. Default: If amount is in typical payroll range ($100-$5000) and no red flags
  // This catches employers we haven't explicitly listed
  if (amount >= 10000 && amount <= 500000) {
    // Additional check: company name should look like a business
    // Exclude single-word generic names
    if (upperCompany.length > 5 && !upperCompany.includes('BANK')) {
      return true;
    }
  }
  
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
  
  // Log filtering stats for debugging
  const excluded = allPayments.length - payrollPayments.length;
  if (excluded > 0) {
    console.log(`[${employerName}] Total: ${allPayments.length}, Payroll: ${payrollPayments.length}, Excluded: ${excluded}`);
  }
  
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
