/**
 * Unit Banking API Client Utilities
 * 
 * Documentation: https://www.unit.co/docs/api/
 * 
 * This module provides typed interfaces and helper functions for
 * interacting with the Unit API for received ACH payments.
 */

// ============================================================================
// Configuration
// ============================================================================

export const UNIT_CONFIG = {
  sandbox: {
    apiUrl: 'https://api.s.unit.sh',
    dashboardUrl: 'https://app.s.unit.sh',
  },
  production: {
    apiUrl: 'https://api.unit.co',
    dashboardUrl: 'https://app.unit.co',
  },
} as const;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Received ACH Payment resource from Unit API
 * Documentation: https://www.unit.co/docs/api/payments/ach/receiving/
 */
export interface ReceivedAchPayment {
  type: 'achReceivedPayment';
  id: string;
  attributes: {
    createdAt: string;  // ISO 8601 timestamp
    amount: number;     // Amount in cents
    completionDate?: string;  // ISO date (YYYY-MM-DD)
    status: ReceivedPaymentStatus;
    companyName?: string;     // Originating company name
    description?: string;     // Payment description
    addenda?: string;         // Optional addenda information
    traceNumber?: string;
    secCode?: string;
  };
  relationships: {
    account: {
      data: {
        type: 'depositAccount';
        id: string;
      };
    };
    customer: {
      data: {
        type: 'individualCustomer' | 'businessCustomer';
        id: string;
      };
    };
    transaction?: {
      data: {
        type: 'receivedAchTransaction';
        id: string;
      };
    };
  };
}

/**
 * Possible statuses for received payments
 */
export type ReceivedPaymentStatus =
  | 'Pending'        // Payment is being processed
  | 'Advanced'       // Funds advanced before settlement
  | 'Completed'      // Payment settled successfully
  | 'Returned'       // Payment was returned
  | 'MarkedForReturn'; // Payment marked for return

/**
 * Unit API List Response structure (JSON:API format)
 */
export interface UnitListResponse<T> {
  data: T[];
  meta?: {
    pagination?: {
      total: number;
      limit: number;
      offset: number;
    };
  };
  included?: any[];
}

/**
 * Query parameters for List Received Payments endpoint
 */
export interface ListReceivedPaymentsParams {
  accountId?: string;
  customerId?: string;
  since?: string;       // ISO date: YYYY-MM-DD
  until?: string;       // ISO date: YYYY-MM-DD
  status?: ReceivedPaymentStatus[];
  includeCompleted?: boolean;
  limit?: number;       // Max 1000
  offset?: number;
}

// ============================================================================
// API Client Functions
// ============================================================================

/**
 * Creates authorization headers for Unit API requests
 */
export function createHeaders(token: string): HeadersInit {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/vnd.api+json',
  };
}

/**
 * Builds query string for List Received Payments endpoint
 */
export function buildReceivedPaymentsQuery(params: ListReceivedPaymentsParams): URLSearchParams {
  const searchParams = new URLSearchParams();

  if (params.accountId) {
    searchParams.set('filter[accountId]', params.accountId);
  }
  if (params.customerId) {
    searchParams.set('filter[customerId]', params.customerId);
  }
  if (params.since) {
    searchParams.set('filter[since]', params.since);
  }
  if (params.until) {
    searchParams.set('filter[until]', params.until);
  }
  if (params.status && params.status.length > 0) {
    params.status.forEach(s => searchParams.append('filter[status][]', s));
  }
  if (params.includeCompleted !== undefined) {
    searchParams.set('filter[includeCompleted]', String(params.includeCompleted));
  }
  if (params.limit !== undefined) {
    searchParams.set('page[limit]', String(Math.min(params.limit, 1000)));
  }
  if (params.offset !== undefined) {
    searchParams.set('page[offset]', String(params.offset));
  }

  return searchParams;
}

/**
 * Fetches all pages of received payments
 */
export async function fetchAllReceivedPayments(
  apiUrl: string,
  token: string,
  params: Omit<ListReceivedPaymentsParams, 'limit' | 'offset'>
): Promise<ReceivedAchPayment[]> {
  const allPayments: ReceivedAchPayment[] = [];
  let offset = 0;
  const limit = 1000;
  let hasMore = true;

  while (hasMore) {
    const queryParams = buildReceivedPaymentsQuery({
      ...params,
      limit,
      offset,
    });

    const response = await fetch(
      `${apiUrl}/received-payments?${queryParams}`,
      { headers: createHeaders(token) }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Unit API error ${response.status}: ${errorBody}`);
    }

    const data: UnitListResponse<ReceivedAchPayment> = await response.json();
    allPayments.push(...data.data);

    // Determine if there are more pages
    const total = data.meta?.pagination?.total;
    if (total !== undefined) {
      hasMore = offset + limit < total;
    } else {
      hasMore = data.data.length === limit;
    }
    offset += limit;
  }

  return allPayments;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Formats cents to dollars string
 */
export function centsToDollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

/**
 * Gets ISO week number from a date
 */
export function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Groups payments by week number
 */
export function groupPaymentsByWeek(
  payments: ReceivedAchPayment[],
  year: number
): Map<number, ReceivedAchPayment[]> {
  const grouped = new Map<number, ReceivedAchPayment[]>();

  for (const payment of payments) {
    const dateStr = payment.attributes.completionDate || payment.attributes.createdAt;
    const date = new Date(dateStr);
    
    if (date.getFullYear() === year) {
      const week = getISOWeekNumber(date);
      const existing = grouped.get(week) || [];
      existing.push(payment);
      grouped.set(week, existing);
    }
  }

  return grouped;
}
