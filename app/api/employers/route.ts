import { NextResponse } from 'next/server';
import customerData from '@/data/customer_company.json';

export const dynamic = 'force-dynamic';

// The JSON structure is: { "customerId": "employerName", ... }
type CustomerMapping = Record<string, string>;

interface Employer {
  customerId: string;
  name: string;
  workerCount: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.toLowerCase().trim() || '';
  
  if (query.length < 2) {
    return NextResponse.json({ employers: [] });
  }

  try {
    const mapping = customerData as CustomerMapping;
    
    // Group customer IDs by employer name and count workers
    const employerGroups = new Map<string, string[]>();
    
    for (const [customerId, employerName] of Object.entries(mapping)) {
      if (!employerGroups.has(employerName)) {
        employerGroups.set(employerName, []);
      }
      employerGroups.get(employerName)!.push(customerId);
    }
    
    // Filter employers matching the search query
    const filtered: Employer[] = [];
    
    for (const [employerName, customerIds] of employerGroups) {
      if (employerName.toLowerCase().includes(query)) {
        filtered.push({
          // Use first customer ID as representative (we'll query all in ach-data)
          customerId: customerIds[0],
          name: employerName,
          workerCount: customerIds.length,
        });
      }
    }
    
    // Sort by worker count (largest employers first) and limit results
    filtered.sort((a, b) => b.workerCount - a.workerCount);
    
    return NextResponse.json({ 
      employers: filtered.slice(0, 20),
    });
  } catch (error) {
    console.error('Error searching employers:', error);
    return NextResponse.json({ employers: [], error: 'Search failed' }, { status: 500 });
  }
}
