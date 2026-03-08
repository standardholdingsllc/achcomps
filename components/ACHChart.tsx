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

interface Props {
  employerName: string;
}

export function ACHChart({ employerName }: Props) {
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const res = await fetch(`/api/ach-data?employer=${encodeURIComponent(employerName)}`);
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
  }, [employerName]);

  // Calculate current week for the reference line
  const currentWeek = Math.ceil(
    (new Date().getTime() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  // Month markers - approximate week number where each month starts
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

  if (loading) {
    return (
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-8 flex items-center justify-center h-[500px]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading ACH data for {employerName}...</p>
          <p className="text-slate-500 text-sm mt-1">This may take a moment for large employers</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--card)] border border-red-500/30 rounded-2xl p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-500/10 mb-4">
          <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-red-400 font-medium">{error}</p>
        <p className="text-slate-500 text-sm mt-2">Please check your API configuration or contact support</p>
      </div>
    );
  }

  // Check if there's any actual data to display
  const hasData = data.some(d => d.year2025 > 0 || (d.year2026 !== null && d.year2026 > 0));
  
  // Calculate max value for Y-axis domain
  const maxValue = Math.max(
    ...data.map(d => Math.max(d.year2025, d.year2026 || 0))
  );
  const yAxisMax = maxValue > 0 ? Math.ceil(maxValue * 1.1) : 10;

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
    <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl p-6 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">
            Weekly ACH Comparison
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Incoming payments aggregated by week for {employerName}
          </p>
        </div>
        
        <div className="flex gap-4 mt-4 md:mt-0">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-indigo-500" />
            <span className="text-sm text-slate-400">2025 (Full Year)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <span className="text-sm text-slate-400">2026 (YTD)</span>
          </div>
        </div>
      </div>

      {!hasData && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-amber-400 font-semibold">No payroll payments found</h3>
              <p className="text-slate-400 text-sm mt-1">
                No incoming ACH payments matching payroll criteria were found for this employer. 
                This could mean the employer&apos;s workers haven&apos;t received payroll deposits yet, 
                or the payments are being filtered out by our payroll detection logic.
              </p>
            </div>
          </div>
        </div>
      )}
      
      <ResponsiveContainer width="100%" height={420}>
        <LineChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
          <defs>
            <linearGradient id="gradient2025" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#6366F1" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="gradient2026" x1="0" y1="0" x2="0" y2="1">
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
          
          {/* Month markers */}
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
          
          {/* Reference line for current week */}
          <ReferenceLine 
            x={`Week ${currentWeek}`} 
            stroke="#F59E0B" 
            strokeDasharray="5 5"
            strokeOpacity={0.7}
            label={{ 
              value: 'Today', 
              position: 'top', 
              fill: '#F59E0B',
              fontSize: 11
            }}
          />
          
          <Line
            type="monotone"
            dataKey="year2025"
            name="2025"
            stroke="#6366F1"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 6, fill: '#6366F1', stroke: '#fff', strokeWidth: 2 }}
          />
          
          <Line
            type="monotone"
            dataKey="year2026"
            name="2026"
            stroke="#F59E0B"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 6, fill: '#F59E0B', stroke: '#fff', strokeWidth: 2 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
      
      {/* Chart Footer */}
      <div className="mt-4 pt-4 border-t border-[var(--card-border)] flex justify-between text-xs text-slate-500">
        <span>Data source: Unit Banking API</span>
        <span>Updated: {new Date().toLocaleDateString()}</span>
      </div>
    </div>
  );
}
