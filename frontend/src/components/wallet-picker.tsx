"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { wallets } from "@/lib/endpoints";
import { cn, formatCurrency } from "@/lib/utils";
import { Star, Wallet as WalletIcon } from "lucide-react";

/**
 * One-tap choice of the money source (for spendings) or destination (for
 * incomes). Picks the default wallet when nothing is selected yet.
 */
export function WalletPicker({
  value,
  onChange,
  label = "Кошелёк",
  hint,
}: {
  value: number | null;
  onChange: (id: number) => void;
  label?: string;
  hint?: string;
}) {
  const q = useQuery({ queryKey: ["wallets"], queryFn: wallets.list });

  const options = useMemo(
    () => (q.data ?? []).filter((w) => w.is_active || w.id === value),
    [q.data, value]
  );

  useEffect(() => {
    if (value != null || options.length === 0) return;
    const fallback = options.find((w) => w.is_default) ?? options[0];
    onChange(fallback.id);
  }, [value, options, onChange]);

  return (
    <div>
      <label className="block text-[12px] font-medium text-ink-2 mb-1.5">
        {label}
      </label>
      {q.isLoading ? (
        <div className="h-9 rounded-md bg-surface-2 animate-pulse" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {options.map((w) => {
            const active = w.id === value;
            return (
              <button
                type="button"
                key={w.id}
                onClick={() => onChange(w.id)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-2 min-w-0 px-2.5 py-2 rounded-md border text-left transition-colors",
                  active
                    ? "bg-accent-soft border-accent/50 text-accent-ink"
                    : "bg-canvas border-hairline-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2"
                )}
              >
                <span
                  className={cn(
                    "h-7 w-7 shrink-0 grid place-items-center rounded",
                    active ? "bg-accent/15" : "bg-surface-2 text-ink-3"
                  )}
                >
                  <WalletIcon className="h-3.5 w-3.5" />
                </span>
                <span className="flex flex-col min-w-0 leading-tight">
                  <span className="text-[13px] font-medium truncate flex items-center gap-1">
                    {w.is_default && (
                      <Star className="h-2.5 w-2.5 shrink-0 fill-current" />
                    )}
                    <span className="truncate">{w.name}</span>
                  </span>
                  <span className="text-[11px] opacity-75 tabular-nums truncate">
                    {!w.is_active
                      ? "отключён"
                      : w.can_view_balance
                      ? formatCurrency(w.balance)
                      : w.code}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {hint && <p className="mt-1.5 text-[12px] text-ink-3">{hint}</p>}
    </div>
  );
}
