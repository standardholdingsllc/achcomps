'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface ChartData {
  week: string;
  weekNum: number;
  year2025: number;
  year2026: number | null;
}

interface UniverseSummaryData {
  totalWorkers: number;
  totalEmployers: number;
  totalPrevYear: number;
  totalCurrYear: number;
  prevYearSamePeriod: number;
  yoyChangePercent: number;
  trend: string;
  computedAt: string;
  previousYear: number;
  currentYear: number;
}

interface ApiResponse {
  chartData: ChartData[];
  summary: UniverseSummaryData | null;
  hasData: boolean;
  error?: string;
}

interface Props {
  refreshKey?: number;
}

export function UniverseSummary({ refreshKey = 0 }: Props) {
  const [data, setData] = useState<ChartData[]>([]);
  const [summary, setSummary] = useState<UniverseSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/universe');
        const json: ApiResponse = await res.json();
        setData(json.chartData || []);
        setSummary(json.summary);
        setHasData(json.hasData);
      } catch (err) {
        console.error('Error fetching universe data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-8">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading universe ACH data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasData || !summary) {
    return (
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-8">
        <h2 className="text-xl font-bold text-white mb-2">All-Company ACH Overview</h2>
        <p className="text-slate-400 text-sm mb-6">
          No universe data computed yet. Run a computation from the Client Performance Overview below to populate this view.
        </p>
      </div>
    );
  }

  const ytdChange = summary.yoyChangePercent;
  const isPositive = ytdChange >= 0;

  const getTrendStatus = () => {
    if (ytdChange > 10) return { label: 'Strong Growth', color: 'text-emerald-400', bg: 'bg-emerald-500/10' };
    if (ytdChange > 0) return { label: 'Growing', color: 'text-emerald-400', bg: 'bg-emerald-500/10' };
    if (ytdChange === 0) return { label: 'Stable', color: 'text-slate-400', bg: 'bg-slate-500/10' };
    if (ytdChange > -10) return { label: 'Slight Decline', color: 'text-amber-400', bg: 'bg-amber-500/10' };
    return { label: 'Significant Decline', color: 'text-rose-400', bg: 'bg-rose-500/10' };
  };
  const trend = getTrendStatus();

  const currentWeek = Math.ceil(
    (new Date().getTime() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const monthMarkers = [
    { week: 1, label: 'Jan' },
    { week: 5, label: 'Feb' },
    { week: 9, label: 'Mar' },
    { week: 14, label: 'Apr' },
    { week: 18, label: 'May' },
    { week: 22, label: 'Jun' },
    { week: 27, label: 'Jul' },
    { week: 31, label: 'Aug' },
    { week: 35, label: 'Sep' },
    { week: 40, label: 'Oct' },
    { week: 44, label: 'Nov' },
    { week: 48, label: 'Dec' },
  ];

  const maxValue = Math.max(
    ...data.map(d => Math.max(d.year2025, d.year2026 || 0))
  );
  const yAxisMax = maxValue > 0 ? Math.ceil(maxValue * 1.1) : 10;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 shadow-xl">
          <p className="text-slate-300 font-medium mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            entry.value !== null && (
              <p key={index} className="text-sm" style={{ color: entry.color }}>
                {entry.name}: <span className="font-bold font-mono">{entry.value.toLocaleString()} ACHs</span>
              </p>
            )
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold text-white">All-Company ACH Overview</h2>
            <p className="text-slate-400 text-sm mt-1">
              Aggregate ACH payments across all {summary.totalEmployers.toLocaleString()} employers
              <span className="text-slate-500"> &bull; Last computed: {formatDate(summary.computedAt)}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="px-6 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Universe scope */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-5">
            <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
              Universe
            </h3>
            <p className="text-2xl font-bold text-white mt-2 font-mono">
              {summary.totalEmployers.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              employers &bull; {summary.totalWorkers.toLocaleString()} workers
            </p>
          </div>

          {/* Previous Year */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-5">
            <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
              {summary.previousYear} Total ACHs
            </h3>
            <p className="text-2xl font-bold text-indigo-400 mt-2 font-mono">
              {summary.totalPrevYear.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Full year completed
            </p>
          </div>

          {/* Current Year YTD */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-5">
            <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
              {summary.currentYear} YTD ACHs
            </h3>
            <p className="text-2xl font-bold text-amber-400 mt-2 font-mono">
              {summary.totalCurrYear.toLocaleString()}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-sm font-medium font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isPositive ? '\u2191' : '\u2193'} {Math.abs(ytdChange).toFixed(1)}%
              </span>
              <span className="text-xs text-slate-500">vs same period {summary.previousYear}</span>
            </div>
          </div>

          {/* Trend */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-5">
            <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
              Season Status
            </h3>
            <div className="mt-2">
              <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${trend.bg} ${trend.color}`}>
                {trend.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Based on YoY comparison
            </p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="px-6 pb-6">
        <div className="bg-slate-800/20 border border-slate-700/30 rounded-xl p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">
                Weekly ACH Comparison &mdash; All Companies
              </h3>
              <p className="text-slate-400 text-sm mt-1">
                Total incoming payroll payments aggregated by week
              </p>
            </div>
            <div className="flex gap-4 mt-3 md:mt-0">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-indigo-500" />
                <span className="text-sm text-slate-400">{summary.previousYear} (Full Year)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="text-sm text-slate-400">{summary.currentYear} (YTD)</span>
              </div>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
              <defs>
                <linearGradient id="universeGradient2025" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6366F1" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="universeGradient2026" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#F59E0B" stopOpacity={0}/>
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#1E293B"
                vertical={false}
              />

              <XAxis
                dataKey="week"
                stroke="#475569"
                tick={false}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
              />

              <YAxis
                stroke="#475569"
                tick={{ fill: '#64748B', fontSize: 11 }}
                tickLine={{ stroke: '#334155' }}
                axisLine={{ stroke: '#334155' }}
                tickFormatter={(value) => value.toLocaleString()}
                domain={[0, yAxisMax]}
              />

              <Tooltip content={<CustomTooltip />} />

              {monthMarkers.map(({ week, label }) => (
                <ReferenceLine
                  key={label}
                  x={`Week ${week}`}
                  stroke="#334155"
                  strokeDasharray="2 4"
                  label={{
                    value: label,
                    position: 'bottom',
                    fill: '#64748B',
                    fontSize: 10,
                    offset: 10,
                  }}
                />
              ))}

              <ReferenceLine
                x={`Week ${currentWeek}`}
                stroke="#F59E0B"
                strokeDasharray="5 5"
                strokeOpacity={0.7}
                label={{
                  value: 'Today',
                  position: 'top',
                  fill: '#F59E0B',
                  fontSize: 11,
                }}
              />

              <Line
                type="monotone"
                dataKey="year2025"
                name={String(summary.previousYear)}
                stroke="#6366F1"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6, fill: '#6366F1', stroke: '#fff', strokeWidth: 2 }}
              />

              <Line
                type="monotone"
                dataKey="year2026"
                name={String(summary.currentYear)}
                stroke="#F59E0B"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 6, fill: '#F59E0B', stroke: '#fff', strokeWidth: 2 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>

          <div className="mt-3 pt-3 border-t border-slate-700/30 flex justify-between text-xs text-slate-500">
            <span>Aggregated across all employers &bull; Source: Unit Banking API</span>
            <span>Computed: {formatDate(summary.computedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
