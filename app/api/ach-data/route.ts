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
      // Cache for 5 minutes
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Unit API Error for customer ${customerId}:`, response.status, errorText);
      // Don't throw - just return what we have (some customers may not exist)
      break;
    }

    const data: UnitApiResponse = await response.json();
    allPayments.push(...data.data);

    // Check pagination
    const total = data.meta?.pagination?.total || data.data.length;
    offset += limit;
    hasMore = offset < total && data.data.length === limit;
  }

  return allPayments;
}

/**
 * Fetches all received payments for ALL customers belonging to an employer
 */
async function fetchAllPaymentsForEmployer(
  employerName: string,
  since: string,
  until: string
): Promise<ReceivedPayment[]> {
  const customerIds = getCustomerIdsForEmployer(employerName);
  
  if (customerIds.length === 0) {
    return [];
  }

  // Fetch payments for all customers in parallel (batch of 10 at a time to avoid rate limits)
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

  return allPayments;
}

/**
 * Gets ISO week number from a date
 */
function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

/**
 * Aggregates payments by week
 */
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

/**
 * Counts payments up to a specific week
 */
function countPaymentsUpToWeek(weekCounts: Map<number, number>, maxWeek: number): number {
  let total = 0;
  for (let week = 1; week <= maxWeek; week++) {
    total += weekCounts.get(week) || 0;
  }
  return total;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get('customerId');
  const employerNameParam = searchParams.get('employer');
  
  // Get employer name - either from param or look up from customer ID
  let employerName: string | null = employerNameParam;
  
  if (!employerName && customerId) {
    employerName = getEmployerName(customerId);
  }
  
  if (!employerName) {
    return NextResponse.json({ error: 'employer or customerId is required' }, { status: 400 });
  }

  try {
    const currentYear = new Date().getFullYear(); // 2026
    const previousYear = currentYear - 1; // 2025
    const currentWeek = getWeekNumber(new Date());
    
    // Fetch previous year data (full year) for ALL workers of this employer
    const prevYearPayments = await fetchAllPaymentsForEmployer(
      employerName,
      `${previousYear}-01-01`,
      `${previousYear}-12-31`
    );
    
    // Fetch current year data (Jan 1 to today)
    const today = new Date().toISOString().split('T')[0];
    const currYearPayments = await fetchAllPaymentsForEmployer(
      employerName,
      `${currentYear}-01-01`,
      today
    );

    // Aggregate by week
    const prevYearByWeek = aggregateByWeek(prevYearPayments, previousYear);
    const currYearByWeek = aggregateByWeek(currYearPayments, currentYear);

    // Build chart data (weeks 1-52)
    const chartData: WeeklyData[] = [];

    for (let week = 1; week <= 52; week++) {
      chartData.push({
        week: `Week ${week}`,
        weekNum: week,
        year2025: prevYearByWeek.get(week) || 0,
        // Only show current year data up to current week
        year2026: week <= currentWeek ? (currYearByWeek.get(week) || 0) : null,
      });
    }

    // Calculate same-period comparison for previous year
    const prevYearSamePeriod = countPaymentsUpToWeek(prevYearByWeek, currentWeek);
    
    // Get worker count for this employer
    const workerCount = getCustomerIdsForEmployer(employerName).length;

    return NextResponse.json({
      chartData,
      summary: {
        employerName,
        workerCount,
        totalPrevYear: prevYearPayments.length,
        totalCurrYear: currYearPayments.length,
        prevYearSamePeriod, // For accurate YoY comparison
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
