import React, { useRef, useEffect, useState } from "react";

export type FilterOption<T extends string | null = string | null> = {
  value: T;
  label: string;
};

type Props<T extends string | null = string | null> = {
  label: string;
  value: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
};

export default function FilterDropdown<T extends string | null = string | null>({
  label,
  value,
  options,
  onChange,
  placeholder = "전체",
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  return (
    <div ref={ref} className="relative flex flex-col w-52">
      <span className="text-[11px] font-semibold tracking-wide text-slate-600 mb-1">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-10 flex items-center justify-between gap-2 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm transition hover:bg-slate-50/70 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-200"
      >
        <span className="truncate">{displayLabel}</span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-[100] mt-1 min-w-full rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value ?? "__all__"}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm transition ${
                opt.value === value
                  ? "bg-indigo-100 text-indigo-900 font-medium"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
