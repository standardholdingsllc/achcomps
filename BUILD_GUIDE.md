# ACH Year-Over-Year Comparison Dashboard
## Build Guide for Unit API Integration

---

## 🎯 Project Overview

Build a Vercel-hosted dashboard that:
1. Pulls incoming ACH payments from the Unit Banking API
2. Cross-references customer IDs with employer names from your masterlist
3. Displays interactive year-over-year comparison charts
4. Allows team members to search by employer name

---

## 📊 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VERCEL HOSTING                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │   React/Next.js │    │  API Routes     │    │   Data      │ │
│  │   Frontend      │───▶│  (Serverless)   │───▶│   Layer     │ │
│  │                 │    │                 │    │             │ │
│  │ • Search UI     │    │ • /api/employers│    │ • Unit API  │ │
│  │ • Chart Display │    │ • /api/ach-data │    │ • Mapping   │ │
│  │ • Date Filters  │    │                 │    │   JSON      │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │       UNIT BANKING API        │
                    │  https://api.s.unit.sh/       │
                    │  (or api.unit.co for Live)    │
                    └───────────────────────────────┘
```

---

## 🔑 Unit API Key Endpoints

### Primary: List Received Payments
**Endpoint:** `GET /received-payments`

**Documentation:** https://www.unit.co/docs/api/payments/ach/receiving/apis

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter[accountId]` | string | Filter by specific account ID |
| `filter[customerId]` | string | Filter by customer ID |
| `filter[since]` | ISO Date | Start date (format: `2025-01-01`) |
| `filter[until]` | ISO Date | End date (format: `2025-12-31`) |
| `filter[status][]` | string | Payment status: `Pending`, `Advanced`, `Completed`, `Returned` |
| `filter[includeCompleted]` | boolean | Include completed payments (default: false) |
| `page[limit]` | integer | Max 1000 per request |
| `page[offset]` | integer | For pagination |

**Example Request:**
```bash
curl -X GET "https://api.s.unit.sh/received-payments?\
filter[customerId]=123456&\
filter[since]=2025-01-01&\
filter[until]=2025-12-31&\
filter[status][]=Completed&\
filter[includeCompleted]=true&\
page[limit]=1000" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/vnd.api+json"
```

**Response Structure (JSON:API format):**
```json
{
  "data": [
    {
      "type": "achReceivedPayment",
      "id": "1234567",
      "attributes": {
        "createdAt": "2025-03-01T10:30:00Z",
        "amount": 150000,
        "completionDate": "2025-03-03",
        "status": "Completed",
        "companyName": "EMPLOYER PAYROLL INC",
        "description": "PAYROLL"
      },
      "relationships": {
        "account": {
          "data": {
            "type": "depositAccount",
            "id": "456789"
          }
        },
        "customer": {
          "data": {
            "type": "individualCustomer",
            "id": "987654"
          }
        }
      }
    }
  ],
  "meta": {
    "pagination": {
      "total": 1250,
      "limit": 1000,
      "offset": 0
    }
  }
}
```

### Alternative: List Transactions
**Endpoint:** `GET /transactions`

**Documentation:** https://www.unit.co/docs/api/transactions/apis/

Use `filter[type][]=ReceivedAch` to get only incoming ACH transactions.

---

## 📋 Implementation Phases

### Phase 1: Project Setup

1. **Initialize Next.js Project**
```bash
npx create-next-app@latest ach-comparison-dashboard --typescript --tailwind --app --eslint
cd ach-comparison-dashboard
```

2. **Install Dependencies**
```bash
npm install recharts date-fns @tanstack/react-query axios
npm install -D @types/node
```

3. **Configure Environment Variables**
Create `.env.local`:
```env
UNIT_API_TOKEN=your_unit_api_token_here
UNIT_API_URL=https://api.s.unit.sh
# Use https://api.unit.co for production
```

---

### Phase 2: Data Mapping Setup

**Customer mapping file is already included:**
- Source: https://raw.githubusercontent.com/standardholdingsllc/hubspot-address-mapper/refs/heads/main/web-app/data/customer_company.json

**Structure (simple key-value mapping):**
```json
{
  "1960476": "Patterson Farms",
  "1960554": "Patterson Farms",
  "2022727": "App Farms",
  "3358124": "Everglades",
  "3359296": "Jackson Citrus",
  ...
}
```

Where:
- **Key** = Unit Customer ID (individual worker's account)
- **Value** = Employer name

The API aggregates all workers (customer IDs) belonging to the same employer when calculating ACH totals.

---

### Phase 3: API Routes (Serverless Functions)

#### `/app/api/employers/route.ts`
Returns searchable list of employers from the mapping file.

```typescript
import { NextResponse } from 'next/server';
import customerCompanyData from '@/data/customer_company.json';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.toLowerCase() || '';
  
  // Adapt this based on your actual JSON structure
  const employers = customerCompanyData.mappings
    .filter(m => m.employerName.toLowerCase().includes(query))
    .map(m => ({
      customerId: m.customerId,
      accountId: m.accountId,
      name: m.employerName
    }))
    .slice(0, 20); // Limit results
  
  return NextResponse.json({ employers });
}
```

#### `/app/api/ach-data/route.ts`
Main data endpoint that queries Unit API.

```typescript
import { NextResponse } from 'next/server';

const UNIT_API_URL = process.env.UNIT_API_URL!;
const UNIT_API_TOKEN = process.env.UNIT_API_TOKEN!;

interface ReceivedPayment {
  id: string;
  attributes: {
    createdAt: string;
    completionDate: string;
    amount: number;
    status: string;
  };
  relationships: {
    customer: { data: { id: string } };
    account: { data: { id: string } };
  };
}

interface AggregatedData {
  week: string;
  year2025: number;
  year2026: number;
}

async function fetchAllReceivedPayments(
  customerId: string,
  since: string,
  until: string
): Promise<ReceivedPayment[]> {
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
    });

    if (!response.ok) {
      throw new Error(`Unit API error: ${response.status}`);
    }

    const data = await response.json();
    allPayments.push(...data.data);

    // Check if there are more pages
    const total = data.meta?.pagination?.total || 0;
    offset += limit;
    hasMore = offset < total;
  }

  return allPayments;
}

function aggregateByWeek(
  payments: ReceivedPayment[],
  year: number
): Map<number, number> {
  const weekCounts = new Map<number, number>();
  
  payments.forEach(payment => {
    const date = new Date(payment.attributes.completionDate || payment.attributes.createdAt);
    if (date.getFullYear() === year) {
      // Get ISO week number
      const startOfYear = new Date(year, 0, 1);
      const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
      const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
      
      weekCounts.set(weekNumber, (weekCounts.get(weekNumber) || 0) + 1);
    }
  });
  
  return weekCounts;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get('customerId');
  
  if (!customerId) {
    return NextResponse.json({ error: 'customerId required' }, { status: 400 });
  }

  try {
    const currentYear = new Date().getFullYear(); // 2026
    const previousYear = currentYear - 1; // 2025
    
    // Fetch previous year data (full year)
    const prevYearPayments = await fetchAllReceivedPayments(
      customerId,
      `${previousYear}-01-01`,
      `${previousYear}-12-31`
    );
    
    // Fetch current year data (Jan 1 to today)
    const today = new Date().toISOString().split('T')[0];
    const currYearPayments = await fetchAllReceivedPayments(
      customerId,
      `${currentYear}-01-01`,
      today
    );

    // Aggregate by week
    const prevYearByWeek = aggregateByWeek(prevYearPayments, previousYear);
    const currYearByWeek = aggregateByWeek(currYearPayments, currentYear);

    // Build chart data (weeks 1-52)
    const chartData: AggregatedData[] = [];
    const currentWeek = Math.ceil(
      (new Date().getTime() - new Date(currentYear, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

    for (let week = 1; week <= 52; week++) {
      chartData.push({
        week: `Week ${week}`,
        year2025: prevYearByWeek.get(week) || 0,
        // Only show current year data up to current week
        year2026: week <= currentWeek ? (currYearByWeek.get(week) || 0) : null as any,
      });
    }

    return NextResponse.json({
      chartData,
      summary: {
        totalPrevYear: prevYearPayments.length,
        totalCurrYear: currYearPayments.length,
        previousYear,
        currentYear,
      }
    });
  } catch (error) {
    console.error('Error fetching ACH data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ACH data' },
      { status: 500 }
    );
  }
}
```

---

### Phase 4: Frontend Components

#### `/app/page.tsx`
Main dashboard page.

```tsx
'use client';

import { useState } from 'react';
import { EmployerSearch } from '@/components/EmployerSearch';
import { ACHChart } from '@/components/ACHChart';
import { SummaryCards } from '@/components/SummaryCards';

interface Employer {
  customerId: string;
  accountId: string;
  name: string;
}

export default function Dashboard() {
  const [selectedEmployer, setSelectedEmployer] = useState<Employer | null>(null);

  return (
    <main className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-amber-400">
            ACH Year-Over-Year Comparison
          </h1>
          <p className="text-slate-400 mt-2">
            Track incoming ACH payments by employer: 2025 vs 2026
          </p>
        </header>

        <div className="mb-8">
          <EmployerSearch onSelect={setSelectedEmployer} />
        </div>

        {selectedEmployer && (
          <>
            <SummaryCards 
              customerId={selectedEmployer.customerId}
              employerName={selectedEmployer.name}
            />
            <ACHChart customerId={selectedEmployer.customerId} />
          </>
        )}
      </div>
    </main>
  );
}
```

#### `/components/EmployerSearch.tsx`
Searchable employer dropdown.

```tsx
'use client';

import { useState, useEffect } from 'react';

interface Employer {
  customerId: string;
  accountId: string;
  name: string;
}

interface Props {
  onSelect: (employer: Employer) => void;
}

export function EmployerSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Employer[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    const search = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/employers?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.employers);
        setIsOpen(true);
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [query]);

  return (
    <div className="relative max-w-md">
      <label className="block text-sm font-medium text-slate-300 mb-2">
        Search Employer
      </label>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type employer name (e.g., Everglades)"
        className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg 
                   text-white placeholder-slate-400 focus:outline-none focus:ring-2 
                   focus:ring-amber-400 focus:border-transparent"
      />
      
      {loading && (
        <div className="absolute right-3 top-10">
          <div className="animate-spin h-5 w-5 border-2 border-amber-400 border-t-transparent rounded-full" />
        </div>
      )}

      {isOpen && results.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-600 
                       rounded-lg shadow-lg max-h-60 overflow-auto">
          {results.map((employer) => (
            <li
              key={employer.customerId}
              onClick={() => {
                onSelect(employer);
                setQuery(employer.name);
                setIsOpen(false);
              }}
              className="px-4 py-3 hover:bg-slate-700 cursor-pointer border-b 
                         border-slate-700 last:border-0"
            >
              <span className="font-medium">{employer.name}</span>
              <span className="text-xs text-slate-400 ml-2">
                ID: {employer.customerId}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

#### `/components/ACHChart.tsx`
Interactive comparison chart.

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface ChartData {
  week: string;
  year2025: number;
  year2026: number | null;
}

interface Props {
  customerId: string;
}

export function ACHChart({ customerId }: Props) {
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const res = await fetch(`/api/ach-data?customerId=${customerId}`);
        if (!res.ok) throw new Error('Failed to fetch data');
        
        const json = await res.json();
        setData(json.chartData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [customerId]);

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-xl p-8 flex items-center justify-center h-96">
        <div className="animate-spin h-8 w-8 border-4 border-amber-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-800 rounded-xl p-8 text-center">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <h2 className="text-xl font-semibold mb-4 text-slate-200">
        Weekly ACH Comparison
      </h2>
      
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis 
            dataKey="week" 
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            interval={3}
          />
          <YAxis 
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1F2937',
              border: '1px solid #374151',
              borderRadius: '8px',
            }}
            labelStyle={{ color: '#F3F4F6' }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="year2025"
            name="2025 (Full Year)"
            stroke="#6366F1"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="year2026"
            name="2026 (YTD)"
            stroke="#F59E0B"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

#### `/components/SummaryCards.tsx`
Summary statistics cards.

```tsx
'use client';

import { useEffect, useState } from 'react';

interface Summary {
  totalPrevYear: number;
  totalCurrYear: number;
  previousYear: number;
  currentYear: number;
}

interface Props {
  customerId: string;
  employerName: string;
}

export function SummaryCards({ customerId, employerName }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch(`/api/ach-data?customerId=${customerId}`);
      const json = await res.json();
      setSummary(json.summary);
    };
    fetchData();
  }, [customerId]);

  if (!summary) return null;

  const percentChange = summary.totalPrevYear > 0
    ? ((summary.totalCurrYear - summary.totalPrevYear) / summary.totalPrevYear * 100).toFixed(1)
    : '0';

  const isPositive = parseFloat(percentChange) >= 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <div className="bg-slate-800 rounded-xl p-6">
        <h3 className="text-slate-400 text-sm font-medium">Selected Employer</h3>
        <p className="text-2xl font-bold text-white mt-2">{employerName}</p>
      </div>
      
      <div className="bg-slate-800 rounded-xl p-6">
        <h3 className="text-slate-400 text-sm font-medium">
          {summary.previousYear} Total ACHs
        </h3>
        <p className="text-2xl font-bold text-indigo-400 mt-2">
          {summary.totalPrevYear.toLocaleString()}
        </p>
      </div>
      
      <div className="bg-slate-800 rounded-xl p-6">
        <h3 className="text-slate-400 text-sm font-medium">
          {summary.currentYear} YTD ACHs
        </h3>
        <p className="text-2xl font-bold text-amber-400 mt-2">
          {summary.totalCurrYear.toLocaleString()}
        </p>
        <p className={`text-sm mt-1 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {isPositive ? '↑' : '↓'} {Math.abs(parseFloat(percentChange))}% vs same period last year
        </p>
      </div>
    </div>
  );
}
```

---

### Phase 5: Vercel Deployment

1. **Push to GitHub**
```bash
git init
git add .
git commit -m "Initial ACH comparison dashboard"
git remote add origin https://github.com/your-org/ach-comparison-dashboard.git
git push -u origin main
```

2. **Deploy to Vercel**
   - Go to https://vercel.com/new
   - Import your GitHub repository
   - Add environment variables:
     - `UNIT_API_TOKEN`: Your Unit API bearer token
     - `UNIT_API_URL`: `https://api.s.unit.sh` (sandbox) or `https://api.unit.co` (production)
   - Deploy

3. **Configure Custom Domain (Optional)**
   - In Vercel project settings, add your custom domain

---

## 🔐 Security Considerations

1. **API Token Security**
   - Never expose `UNIT_API_TOKEN` on the client side
   - All Unit API calls must go through server-side API routes
   - Use Vercel environment variables (not `.env` committed to git)

2. **Access Control**
   - Consider adding authentication (Vercel Auth, NextAuth.js, etc.)
   - Restrict access to your team only

3. **Rate Limiting**
   - Unit API has rate limits; implement caching for frequently accessed data
   - Consider a nightly job to pre-aggregate data into a database

---

## 📈 Performance Optimizations (Future Enhancements)

### Option A: Background Data Sync
Instead of real-time API calls, set up a cron job (Vercel Cron or external):

```typescript
// /app/api/sync/route.ts
// Run nightly to pre-aggregate ACH data into a database (e.g., Vercel Postgres)
```

### Option B: Redis Caching
Cache aggregated results with a TTL:
```bash
npm install @upstash/redis
```

### Option C: Client-Side Caching
Use React Query or SWR for client-side caching:
```bash
npm install @tanstack/react-query
```

---

## 📁 Recommended File Structure

```
ach-comparison-dashboard/
├── app/
│   ├── api/
│   │   ├── employers/
│   │   │   └── route.ts
│   │   └── ach-data/
│   │       └── route.ts
│   ├── page.tsx
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── EmployerSearch.tsx
│   ├── ACHChart.tsx
│   └── SummaryCards.tsx
├── data/
│   └── customer_company.json
├── lib/
│   └── unit-api.ts
├── .env.local
├── .gitignore
├── next.config.js
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

---

## ✅ Pre-Flight Checklist

Before starting development:

- [ ] Obtain Unit API token from Unit Dashboard (https://app.s.unit.sh for sandbox)
- [ ] Ensure token has `received-payments` scope
- [ ] Download your `customer_company.json` from GitHub
- [ ] Verify the JSON structure matches expected format (adjust code if needed)
- [ ] Decide on sandbox vs production API URL
- [ ] Set up GitHub repository
- [ ] Create Vercel account (if not already)

---

## 🔗 Resources

- **Unit API Documentation:** https://www.unit.co/docs/api/
- **Received Payments API:** https://www.unit.co/docs/api/payments/ach/receiving/apis
- **Transactions API:** https://www.unit.co/docs/api/transactions/apis/
- **Unit TypeScript SDK:** https://github.com/unit-finance/unit-node-sdk
- **Recharts Documentation:** https://recharts.org/
- **Next.js App Router:** https://nextjs.org/docs/app
- **Vercel Deployment:** https://vercel.com/docs

---

## 🚀 Quick Start Commands

```bash
# 1. Create project
npx create-next-app@latest ach-comparison-dashboard --typescript --tailwind --app --eslint

# 2. Enter directory
cd ach-comparison-dashboard

# 3. Install dependencies
npm install recharts date-fns axios

# 4. Create .env.local with your credentials
echo "UNIT_API_TOKEN=your_token_here" >> .env.local
echo "UNIT_API_URL=https://api.s.unit.sh" >> .env.local

# 5. Start development
npm run dev
```

---

## 💡 Notes on Your Use Case

Since you're tracking ACH payments for **employers who pay seasonal workers**:

1. **Seasonal Pattern Detection**: The chart will naturally show when employers start their seasons (spike in March-April for agriculture)

2. **Volume Tracking**: The line chart shows ACH *count*, not amount. If you also want to track total *dollar volume*, modify the aggregation to sum `amount` instead of counting

3. **Multiple Accounts per Employer**: If an employer has multiple customer IDs/accounts, you may need to aggregate across all of them. Update your mapping file to support this.

4. **Historical Comparison**: Consider adding a dropdown to compare any two years (not just current vs previous)

---

*Build Guide v1.0 | Created for Standard Holdings ACH Tracking Dashboard*
