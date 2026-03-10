'use client';

import { useState } from 'react';
import { EmployerSearch } from '@/components/EmployerSearch';
import { ACHChart } from '@/components/ACHChart';
import { SummaryCards } from '@/components/SummaryCards';
import { PerformanceOverview } from '@/components/PerformanceOverview';

interface Employer {
  customerId: string;
  name: string;
  workerCount: number;
}

export default function Dashboard() {
  const [selectedEmployer, setSelectedEmployer] = useState<Employer | null>(null);

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

        {/* Overview Report — Front and center */}
        <section className="mb-10">
          <PerformanceOverview onSelectEmployer={setSelectedEmployer} />
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

        {/* Footer */}
        <footer className="mt-20 pt-6 border-t border-slate-800 text-center text-sm text-slate-500">
          ACH Tracking Dashboard • Powered by Unit API
        </footer>
      </div>
    </main>
  );
}
