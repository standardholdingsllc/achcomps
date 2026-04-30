import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface WeeklyRow {
  week_number: number;
  year: number;
  ach_count: number;
}

interface SummaryRow {
  id: string;
  prev_year_total: number;
  prev_year_same_period: number;
  curr_year_total: number;
  yoy_change_percent: number;
  trend: string;
  total_workers: number;
  total_employers: number;
  previous_year: number;
  current_year: number;
  computed_at: string;
}

export async function GET() {
  try {
    const [weeklyResult, summaryResult] = await Promise.all([
      getSupabase()
        .from('universe_weekly_ach')
        .select('week_number, year, ach_count')
        .order('year', { ascending: true })
        .order('week_number', { ascending: true }),
      getSupabase()
        .from('universe_summary')
        .select('*')
        .eq('id', 'latest')
        .single(),
    ]);

    if (weeklyResult.error) {
      throw new Error(weeklyResult.error.message);
    }

    const summary: SummaryRow | null = summaryResult.data;
    const weeklyData: WeeklyRow[] = weeklyResult.data || [];

    if (!summary || weeklyData.length === 0) {
      return NextResponse.json({
        chartData: [],
        summary: null,
        hasData: false,
      });
    }

    const previousYear = summary.previous_year;
    const currentYear = summary.current_year;

    // Build lookup maps from weekly data
    const prevByWeek = new Map<number, number>();
    const currByWeek = new Map<number, number>();
    for (const row of weeklyData) {
      if (row.year === previousYear) {
        prevByWeek.set(row.week_number, row.ach_count);
      } else if (row.year === currentYear) {
        currByWeek.set(row.week_number, row.ach_count);
      }
    }

    // Determine last complete week from current year data
    const currentWeekNum = getWeekNumber(new Date());
    const lastCompleteWeek = Math.max(currentWeekNum - 1, 1);

    // Build chart data in the same shape as /api/ach-data
    const chartData = [];
    for (let week = 1; week <= 52; week++) {
      chartData.push({
        week: `Week ${week}`,
        weekNum: week,
        year2025: prevByWeek.get(week) || 0,
        year2026: week <= lastCompleteWeek ? (currByWeek.get(week) || 0) : null,
      });
    }

    return NextResponse.json({
      chartData,
      summary: {
        totalWorkers: summary.total_workers,
        totalEmployers: summary.total_employers,
        totalPrevYear: summary.prev_year_total,
        totalCurrYear: summary.curr_year_total,
        prevYearSamePeriod: summary.prev_year_same_period,
        yoyChangePercent: summary.yoy_change_percent,
        trend: summary.trend,
        computedAt: summary.computed_at,
        previousYear,
        currentYear,
      },
      hasData: true,
    });
  } catch (error) {
    console.error('Error fetching universe data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch universe data', chartData: [], summary: null, hasData: false },
      { status: 500 },
    );
  }
}

function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}
