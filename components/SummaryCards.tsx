'use client';

import { useEffect, useState } from 'react';

interface Summary {
  employerName: string;
  workerCount: number;
  totalPrevYear: number;
  totalCurrYear: number;
  previousYear: number;
  currentYear: number;
  prevYearSamePeriod: number;
}

interface Props {
  employerName: string;
}

export function SummaryCards({ employerName }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/ach-data?employer=${encodeURIComponent(employerName)}`);
        const json = await res.json();
        setSummary(json.summary);
      } catch (error) {
        console.error('Error fetching summary:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [employerName]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-6 animate-pulse">
            <div className="h-4 bg-slate-700 rounded w-24 mb-3" />
            <div className="h-8 bg-slate-700 rounded w-32" />
          </div>
        ))}
      </div>
    );
  }

  if (!summary) return null;

  // Calculate YoY change comparing same period (YTD vs YTD)
  const ytdChange = summary.prevYearSamePeriod > 0
    ? ((summary.totalCurrYear - summary.prevYearSamePeriod) / summary.prevYearSamePeriod * 100)
    : 0;

  const isPositive = ytdChange >= 0;

  // Determine trend status
  const getTrendStatus = () => {
    if (ytdChange > 10) return { label: 'Strong Growth', color: 'text-emerald-400', bg: 'bg-emerald-500/10' };
    if (ytdChange > 0) return { label: 'Growing', color: 'text-emerald-400', bg: 'bg-emerald-500/10' };
    if (ytdChange === 0) return { label: 'Stable', color: 'text-slate-400', bg: 'bg-slate-500/10' };
    if (ytdChange > -10) return { label: 'Slight Decline', color: 'text-amber-400', bg: 'bg-amber-500/10' };
    return { label: 'Significant Decline', color: 'text-rose-400', bg: 'bg-rose-500/10' };
  };

  const trend = getTrendStatus();

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      {/* Employer Name */}
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-6">
        <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
          Selected Employer
        </h3>
        <p className="text-xl font-bold text-white mt-2 truncate" title={employerName}>
          {employerName}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {summary.workerCount} workers in system
        </p>
      </div>
      
      {/* Previous Year Total */}
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-6">
        <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
          {summary.previousYear} Total ACHs
        </h3>
        <p className="text-3xl font-bold text-indigo-400 mt-2 font-mono">
          {summary.totalPrevYear.toLocaleString()}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Full year completed
        </p>
      </div>
      
      {/* Current Year YTD */}
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-6">
        <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
          {summary.currentYear} YTD ACHs
        </h3>
        <p className="text-3xl font-bold text-amber-400 mt-2 font-mono">
          {summary.totalCurrYear.toLocaleString()}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-sm font-medium font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isPositive ? '↑' : '↓'} {Math.abs(ytdChange).toFixed(1)}%
          </span>
          <span className="text-xs text-slate-500">vs same period {summary.previousYear}</span>
        </div>
      </div>
      
      {/* Trend Status */}
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-6">
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
  );
}
