'use client';

import { useState, useEffect, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

interface EmployerOverview {
  employer_name: string;
  worker_count: number;
  prev_year_same_period: number;
  curr_year_total: number;
  prev_year_full: number;
  yoy_change_percent: number;
  trend: string;
  computed_at: string;
}

interface Props {
  onSelectEmployer: (employer: { customerId: string; name: string; workerCount: number }) => void;
}

type TabKey = 'worst' | 'best';

// ============================================================================
// Component
// ============================================================================

export function PerformanceOverview({ onSelectEmployer }: Props) {
  const [employers, setEmployers] = useState<EmployerOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('worst');
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState({ message: '', percent: 0 });
  const [error, setError] = useState<string | null>(null);

  // ---------- Fetch overview data from Supabase ----------
  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/overview');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setEmployers(json.employers || []);
      setLastUpdated(json.lastUpdated);
    } catch (err) {
      console.error('Error fetching overview:', err);
      setError(err instanceof Error ? err.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // ---------- Trigger compute ----------
  const startCompute = async () => {
    setComputing(true);
    setProgress({ message: 'Starting...', percent: 0 });
    setError(null);

    try {
      const res = await fetch('/api/overview/compute', { method: 'POST' });

      if (!res.body) {
        throw new Error('No response stream');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (part.startsWith('data: ')) {
            try {
              const event = JSON.parse(part.slice(6));
              if (event.type === 'progress') {
                setProgress({ message: event.message, percent: event.progress });
              } else if (event.type === 'complete') {
                setProgress({ message: event.message, percent: 100 });
              } else if (event.type === 'error') {
                setError(event.message);
              }
            } catch {
              // Ignore malformed SSE
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compute failed');
    } finally {
      setComputing(false);
      // Refresh the data from Supabase
      await fetchOverview();
    }
  };

  // ---------- Sort data by tab ----------
  const worstPerformers = [...employers]
    .sort((a, b) => a.yoy_change_percent - b.yoy_change_percent)
    .slice(0, 25);

  const bestPerformers = [...employers]
    .sort((a, b) => b.yoy_change_percent - a.yoy_change_percent)
    .slice(0, 25);

  const displayData = activeTab === 'worst' ? worstPerformers : bestPerformers;

  // ---------- Helpers ----------
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

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'Strong Growth': return 'text-emerald-400 bg-emerald-500/10';
      case 'Growing': return 'text-emerald-400 bg-emerald-500/10';
      case 'Stable': return 'text-slate-400 bg-slate-500/10';
      case 'Slight Decline': return 'text-amber-400 bg-amber-500/10';
      case 'Significant Decline': return 'text-rose-400 bg-rose-500/10';
      default: return 'text-slate-400 bg-slate-500/10';
    }
  };

  const getChangeColor = (pct: number) => {
    if (pct > 0) return 'text-emerald-400';
    if (pct < 0) return 'text-rose-400';
    return 'text-slate-400';
  };

  // ---------- Render ----------
  return (
    <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Client Performance Overview</h2>
            <p className="text-slate-400 text-sm mt-1">
              {employers.length > 0
                ? `${employers.length} employers tracked`
                : 'No data yet — run a computation to get started'}
              {lastUpdated && (
                <span className="text-slate-500"> • Last updated: {formatDate(lastUpdated)}</span>
              )}
            </p>
          </div>

          <button
            onClick={startCompute}
            disabled={computing}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all
              ${computing
                ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                : 'bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/20 hover:shadow-amber-400/30'
              }`}
          >
            {computing ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin" />
                Computing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {employers.length > 0 ? 'Refresh Data' : 'Compute Overview'}
              </>
            )}
          </button>
        </div>

        {/* Progress bar */}
        {computing && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span>{progress.message}</span>
              <span className="font-mono">{progress.percent}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && !computing && (
          <div className="mt-4 bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-3 text-sm text-rose-400">
            {error}
          </div>
        )}
      </div>

      {/* Tabs */}
      {employers.length > 0 && (
        <>
          <div className="px-6 border-b border-[var(--card-border)]">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab('worst')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'worst'
                    ? 'border-rose-400 text-rose-400'
                    : 'border-transparent text-slate-400 hover:text-slate-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                  </svg>
                  Needs Attention
                </span>
              </button>
              <button
                onClick={() => setActiveTab('best')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'best'
                    ? 'border-emerald-400 text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Top Performers
                </span>
              </button>
            </div>
          </div>

          {/* Table Header */}
          <div className="px-6 py-3 bg-slate-900/50 border-b border-[var(--card-border)]">
            <div className="grid grid-cols-12 gap-4 text-xs font-medium text-slate-500 uppercase tracking-wider">
              <div className="col-span-1">#</div>
              <div className="col-span-3">Employer</div>
              <div className="col-span-1 text-right">Workers</div>
              <div className="col-span-2 text-right" title="Unique individuals who received ACH in 2025 (same period)">2025 Unique ACH</div>
              <div className="col-span-2 text-right" title="Unique individuals who received ACH in 2026 YTD">2026 Unique ACH</div>
              <div className="col-span-1 text-right">YoY</div>
              <div className="col-span-2 text-right">Status</div>
            </div>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-[var(--card-border)]">
            {displayData.map((employer, index) => (
              <button
                key={employer.employer_name}
                onClick={() =>
                  onSelectEmployer({
                    customerId: '',
                    name: employer.employer_name,
                    workerCount: employer.worker_count,
                  })
                }
                className={`w-full px-6 py-4 grid grid-cols-12 gap-4 items-center text-left 
                  transition-colors hover:bg-slate-800/50 group cursor-pointer
                  ${activeTab === 'worst' && index < 3 ? 'bg-rose-500/5' : ''}
                  ${activeTab === 'best' && index < 3 ? 'bg-emerald-500/5' : ''}`}
              >
                {/* Rank */}
                <div className="col-span-1">
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold
                    ${index < 3
                      ? activeTab === 'worst'
                        ? 'bg-rose-500/20 text-rose-400'
                        : 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-slate-800 text-slate-500'
                    }`}>
                    {index + 1}
                  </span>
                </div>

                {/* Employer Name */}
                <div className="col-span-3">
                  <span className="font-semibold text-white group-hover:text-amber-400 transition-colors truncate block">
                    {employer.employer_name}
                  </span>
                </div>

                {/* Worker Count */}
                <div className="col-span-1 text-right">
                  <span className="text-sm text-slate-400 font-mono">
                    {employer.worker_count.toLocaleString()}
                  </span>
                </div>

                {/* Previous Year Same Period - Unique ACH Recipients */}
                <div className="col-span-2 text-right">
                  <span className="text-sm text-indigo-400 font-mono font-medium" title="Unique individuals who received ACH">
                    {employer.prev_year_same_period.toLocaleString()}
                  </span>
                </div>

                {/* Current Year Total - Unique ACH Recipients */}
                <div className="col-span-2 text-right">
                  <span className="text-sm text-amber-400 font-mono font-medium" title="Unique individuals who received ACH">
                    {employer.curr_year_total.toLocaleString()}
                  </span>
                </div>

                {/* YoY Change */}
                <div className="col-span-1 text-right">
                  <span className={`text-sm font-bold font-mono ${getChangeColor(employer.yoy_change_percent)}`}>
                    {employer.yoy_change_percent > 0 ? '+' : ''}
                    {employer.yoy_change_percent.toFixed(1)}%
                  </span>
                </div>

                {/* Trend Badge */}
                <div className="col-span-2 text-right">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getTrendColor(employer.trend)}`}>
                    {employer.trend}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-slate-900/30 border-t border-[var(--card-border)] text-xs text-slate-500">
            Showing top {displayData.length} {activeTab === 'worst' ? 'declining' : 'growing'} employers
            {activeTab === 'worst' && (
              <span className="text-slate-600"> — click any row to view detailed YoY chart</span>
            )}
          </div>
        </>
      )}

      {/* Empty State */}
      {!loading && !computing && employers.length === 0 && !error && (
        <div className="px-6 pb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800/50 border border-slate-700 mb-4 mt-2">
            <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No overview data yet</h3>
          <p className="text-slate-500 max-w-md mx-auto mb-6">
            Click &quot;Compute Overview&quot; to fetch ACH data for all employers and calculate year-over-year performance metrics.
          </p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="px-6 pb-8 pt-4 flex justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Loading overview data...</p>
          </div>
        </div>
      )}
    </div>
  );
}
