import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '— בחר —',
  emptyText = 'אין תוצאות',
  searchPlaceholder = 'חפש...',
  allowClear = true,
  disabled = false,
  className = '',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel || '').toLowerCase().includes(q)
    );
  }, [options, search]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="form-input w-full text-right disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-2"
      >
        <span className={selected ? '' : 'text-gray-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="flex items-center gap-1 text-gray-400">
          {selected && allowClear && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange(''); setSearch(''); }}
              className="hover:text-gray-700"
              aria-label="נקה בחירה"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={14} />
        </span>
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-80 overflow-hidden flex flex-col">
          <div className="p-2 border-b flex items-center gap-2">
            <Search size={16} className="text-gray-400" />
            <input
              autoFocus
              type="text"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 outline-none text-sm bg-transparent"
            />
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-3 text-sm text-gray-500 text-center">{emptyText}</div>
            ) : (
              filtered.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false); setSearch(''); }}
                  className={`w-full text-right px-3 py-2 hover:bg-blue-50 text-sm border-b last:border-b-0 ${o.value === value ? 'bg-blue-50 font-medium' : ''}`}
                >
                  <div>{o.label}</div>
                  {o.sublabel && <div className="text-xs text-gray-500">{o.sublabel}</div>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
