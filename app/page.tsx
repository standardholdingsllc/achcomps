'use client';

import { useState } from 'react';
import { EmployerSearch } from '@/components/EmployerSearch';
import { ACHChart } from '@/components/ACHChart';
import { SummaryCards } from '@/components/SummaryCards';

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
            <div className="w-2 h-8 bg-amber-400 rounded-full" />
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              ACH Year-Over-Year
            </h1>
          </div>
          <p className="text-slate-400 text-lg ml-5">
            Track incoming ACH payments by employer — compare 2025 vs 2026 seasonal activity
          </p>
        </header>

        {/* Search Section */}
        <section className="mb-10">
          <EmployerSearch onSelect={setSelectedEmployer} />
        </section>

        {/* Results Section */}
        {selectedEmployer ? (
          <div className="space-y-6 animate-in fade-in duration-500">
            <SummaryCards employerName={selectedEmployer.name} />
            <ACHChart employerName={selectedEmployer.name} />
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-slate-800/50 border border-slate-700 mb-6">
              <svg className="w-10 h-10 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-300 mb-2">
              Search for an employer
            </h2>
            <p className="text-slate-500 max-w-md mx-auto">
              Start typing an employer name above to view their year-over-year ACH payment comparison
            </p>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-20 pt-6 border-t border-slate-800 text-center text-sm text-slate-500">
          Standard Holdings • ACH Tracking Dashboard • Powered by Unit API
        </footer>
      </div>
    </main>
  );
}
