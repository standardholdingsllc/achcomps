'use client';

import { useState, useCallback } from 'react';
import { EmployerSearch } from '@/components/EmployerSearch';
import { ACHChart } from '@/components/ACHChart';
import { SummaryCards } from '@/components/SummaryCards';
import { PerformanceOverview } from '@/components/PerformanceOverview';
import { UniverseSummary } from '@/components/UniverseSummary';

interface Employer {
  customerId: string;
  name: string;
  workerCount: number;
}

export default function Dashboard() {
  const [selectedEmployer, setSelectedEmployer] = useState<Employer | null>(null);
  const [universeRefreshKey, setUniverseRefreshKey] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ message: '', percent: 0 });

  const handleComputeComplete = useCallback(() => {
    setUniverseRefreshKey(k => k + 1);
  }, []);

  const handleManualScan = async () => {
    setScanning(true);
    setScanProgress({ message: 'Starting...', percent: 0 });

    try {
      const res = await fetch('/api/overview/compute', { method: 'POST' });
      if (!res.body) throw new Error('No response stream');

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
                setScanProgress({ message: event.message, percent: event.progress });
              } else if (event.type === 'complete') {
                setScanProgress({ message: event.message, percent: 100 });
              }
            } catch {
              // Ignore malformed SSE
            }
          }
        }
      }
    } catch (err) {
      console.error('Manual scan error:', err);
    } finally {
      setScanning(false);
      setScanProgress({ message: '', percent: 0 });
      setUniverseRefreshKey(k => k + 1);
    }
  };

  return (
    <main className="min-h-screen p-6 md:p-10">
      {/* Background gradient effect */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-40 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <img 
              src="/yepzy-logo.png" 
              alt="Yepzy Logo" 
              className="w-10 h-10 md:w-12 md:h-12 object-contain"
            />
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Yepzy ACH Year-Over-Year
            </h1>
          </div>
          <p className="text-slate-400 text-lg ml-5">
            Track incoming ACH payments by employer — compare 2025 vs 2026 seasonal activity
          </p>
        </header>

        {/* Universe-wide ACH Overview — Default landing view */}
        <section className="mb-10">
          <UniverseSummary refreshKey={universeRefreshKey} />
        </section>

        {/* Per-Employer Overview */}
        <section className="mb-10">
          <PerformanceOverview onSelectEmployer={setSelectedEmployer} onComputeComplete={handleComputeComplete} />
        </section>

        {/* Search Section */}
        <section className="mb-10">
          <EmployerSearch onSelect={setSelectedEmployer} />
        </section>

        {/* Detail Section — shows when an employer is selected from overview or search */}
        {selectedEmployer ? (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-300">
                Detailed View: <span className="text-white">{selectedEmployer.name}</span>
              </h2>
              <button
                onClick={() => setSelectedEmployer(null)}
                className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                ✕ Close detail
              </button>
            </div>
            <SummaryCards employerName={selectedEmployer.name} />
            <ACHChart employerName={selectedEmployer.name} />
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800/50 border border-slate-700 mb-4">
              <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-300 mb-2">
              Select an employer for details
            </h2>
            <p className="text-slate-500 max-w-md mx-auto">
              Click a row in the overview above, or use the search bar to view the full year-over-year ACH chart
            </p>
          </div>
        )}

        {/* Manual Scan */}
        <div className="mt-16 flex flex-col items-center gap-3">
          <button
            onClick={handleManualScan}
            disabled={scanning}
            className="group flex items-center gap-2 px-4 py-2 rounded-lg text-xs text-slate-600 hover:text-slate-400 border border-slate-800/50 hover:border-slate-700 bg-transparent hover:bg-slate-800/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scanning ? (
              <>
                <div className="w-3 h-3 border-[1.5px] border-slate-600 border-t-slate-400 rounded-full animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 opacity-50 group-hover:opacity-80 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Run company-wide ACH scan
              </>
            )}
          </button>
          {scanning && (
            <div className="w-64">
              <div className="flex items-center justify-between text-[10px] text-slate-600 mb-1">
                <span className="truncate max-w-[200px]">{scanProgress.message}</span>
                <span className="font-mono ml-2">{scanProgress.percent}%</span>
              </div>
              <div className="w-full bg-slate-800/50 rounded-full h-1 overflow-hidden">
                <div
                  className="h-full bg-slate-600 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${scanProgress.percent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="mt-6 pt-6 border-t border-slate-800 text-center text-sm text-slate-500">
          ACH Tracking Dashboard • Powered by Unit API
        </footer>
      </div>
    </main>
  );
}
