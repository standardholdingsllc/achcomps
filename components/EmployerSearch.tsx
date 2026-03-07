'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Employer {
  customerId: string;
  name: string;
  workerCount: number;
}

interface Props {
  onSelect: (employer: Employer) => void;
}

export function EmployerSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Employer[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const search = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/employers?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.employers);
        setIsOpen(true);
        setSelectedIndex(-1);
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          handleSelect(results[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  const handleSelect = useCallback((employer: Employer) => {
    setIsOpen(false);
    setResults([]);
    setQuery(employer.name);
    setSelectedIndex(-1);
    // Small delay to ensure dropdown closes before triggering data fetch
    setTimeout(() => {
      onSelect(employer);
    }, 10);
  }, [onSelect]);

  return (
    <div ref={containerRef} className="relative max-w-xl">
      <label className="block text-sm font-medium text-slate-300 mb-3 ml-1">
        Search Employer
      </label>
      
      <div className="relative">
        <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
          {loading ? (
            <div className="w-5 h-5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </div>
        
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Type employer name (e.g., Everglades, Patterson, etc.)"
          className="w-full pl-12 pr-4 py-4 bg-[var(--card)] border border-[var(--card-border)] rounded-xl 
                     text-white text-lg placeholder-slate-500 
                     focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400/50
                     hover:border-slate-600"
        />
      </div>

      {/* Dropdown Results */}
      {isOpen && results.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 w-full mt-2 bg-[var(--card)] border border-[var(--card-border)] 
                     rounded-xl shadow-2xl shadow-black/20 max-h-80 overflow-auto"
        >
          {results.map((employer, index) => (
            <li
              key={employer.name}
              onClick={() => handleSelect(employer)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`px-4 py-4 cursor-pointer border-b border-[var(--card-border)] last:border-0
                         transition-colors duration-100
                         ${selectedIndex === index 
                           ? 'bg-amber-500/10 border-l-2 border-l-amber-400' 
                           : 'hover:bg-slate-800/50'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{employer.name}</span>
                <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded-full">
                  {employer.workerCount} workers
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* No Results */}
      {isOpen && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute z-50 w-full mt-2 bg-[var(--card)] border border-[var(--card-border)] 
                        rounded-xl p-6 text-center">
          <p className="text-slate-400">No employers found matching &quot;{query}&quot;</p>
        </div>
      )}
    </div>
  );
}
