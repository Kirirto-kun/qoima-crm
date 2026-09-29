"use client";

import { useMemo } from "react";
import { cn, formatCurrency, plural } from "@/lib/utils";
import type { ByWalletRow, Wallet } from "@/lib/types";
import { Star, Wallet as WalletIcon } from "lucide-react";

/**
 * "Where did the money come from / go to": one card per wallet with its share
 * of the current selection. Clicking a card filters the page by that wallet.
 */
export function WalletBreakdown({
  rows,
  wallets,
  active,
  onSelect,
  verb,
}: {
  rows: ByWalletRow[];
  wallets: Wallet[];
  active: number | null;
  onSelect: (id: number | null) => void;
  verb: string;
}) {
  const items = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.wallet ?? 0, r]));
    const list = wallets
      .filter((w) => w.is_active || byId.has(w.id))
      .map((w) => {
        const row = byId.get(w.id);
        return {
          id: w.id,
          name: w.name,
          isDefault: w.is_default,
          amount: Number(row?.total_amount ?? 0),
          count: row?.count ?? 0,
        };
      });
    return list.sort((a, b) => b.amount - a.amount);
  }, [rows, wallets]);

  const total = items.reduce((acc, i) => acc + i.amount, 0);

  if (items.length < 2) return null;

  return (
    <section className="mb-6 anim-fade">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[13px] font-medium text-ink-2">По кошелькам</h2>
        {active != null && (
          <button
            onClick={() => onSelect(null)}
            className="text-[12px] text-accent hover:underline"
          >
            Все кошельки
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {items.map((item) => {
          const pct = total > 0 ? (item.amount / total) * 100 : 0;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(isActive ? null : item.id)}
              className={cn(
                "text-left rounded-lg border px-4 py-3 transition-colors",
                isActive
                  ? "bg-accent-soft border-accent/40"
                  : "bg-canvas border-hairline hover:bg-surface"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] text-ink-3 min-w-0">
                  <WalletIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item.name}</span>
                  {item.isDefault && (
                    <Star className="h-2.5 w-2.5 shrink-0 fill-current text-accent" />
                  )}
                </span>
                <span className="text-[11px] text-ink-4 tabular-nums">
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div
                className={cn(
                  "font-display text-[18px] tabular-nums mt-1",
                  isActive ? "text-accent-ink" : "text-ink"
                )}
              >
                {formatCurrency(item.amount)}
              </div>
              <div className="mt-2 h-1 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1.5 text-[11px] text-ink-4">
                {verb} · {item.count}{" "}
                {plural(item.count, "запись", "записи", "записей")}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
