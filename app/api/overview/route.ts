import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data, error } = await getSupabase()
      .from('employer_overview')
      .select('*')
      .order('yoy_change_percent', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    // Find the most recent computed_at timestamp
    let lastUpdated: string | null = null;
    if (data && data.length > 0) {
      lastUpdated = data.reduce((latest, row) => {
        return row.computed_at > latest ? row.computed_at : latest;
      }, data[0].computed_at);
    }

    return NextResponse.json({
      employers: data || [],
      lastUpdated,
      count: data?.length || 0,
    });
  } catch (error) {
    console.error('Error fetching overview:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch overview', employers: [] },
      { status: 500 },
    );
  }
}
