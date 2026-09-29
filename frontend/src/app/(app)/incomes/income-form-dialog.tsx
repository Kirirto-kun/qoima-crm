"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field, Textarea } from "@/components/ui/input";
import { WalletPicker } from "@/components/wallet-picker";
import { incomes } from "@/lib/endpoints";
import { asApiError } from "@/lib/api";
import { allKnownIncomeTypes, typeMetaForIncome } from "@/lib/income-type-meta";
import { cn } from "@/lib/utils";
import { Loader2, Plus, TrendingUp } from "lucide-react";
import type { Income } from "@/lib/types";

const QUICK_TYPES = ["deal_payment", "consulting", "product", "other"];

export function IncomeFormDialog({
  trigger,
  initial,
}: {
  trigger: React.ReactNode;
  initial?: Income;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState(initial?.type ?? "deal_payment");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [wallet, setWallet] = useState<number | null>(initial?.wallet ?? null);

  const meta = typeMetaForIncome(type);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        type: type.trim(),
        amount,
        note: note.trim() || undefined,
        wallet,
      };
      return initial
        ? incomes.update(initial.id, payload)
        : incomes.create(payload);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["incomes"] });
      qc.invalidateQueries({ queryKey: ["incomes-analytics"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["wallets-current"] });
      qc.invalidateQueries({ queryKey: ["wallets-logs"] });
      qc.invalidateQueries({ queryKey: ["wallets-analytics"] });
      toast.success(
        initial
          ? "Запись обновлена."
          : `Доход записан${saved.wallet_name ? ` · ${saved.wallet_name}` : ""}.`
      );
      setOpen(false);
      if (!initial) {
        setName("");
        setAmount("");
        setNote("");
      }
    },
    onError: (err) => toast.error(asApiError(err).message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)}>{trigger}</div>
      <DialogContent className="max-w-[520px]">
        <DialogHeader
          eyebrow={initial ? "Финансы · Изменить" : "Финансы · Новый"}
          title={
            <span className="flex items-center gap-2.5">
              <span className="h-9 w-9 grid place-items-center bg-tag-green-bg text-tag-green-fg rounded-md">
                <TrendingUp className="h-4 w-4" />
              </span>
              <span>
                {initial ? "Редактировать доход" : "Записать доход"}
              </span>
            </span>
          }
          description={
            initial
              ? "Обновите данные — дата записи не меняется."
              : "Зафиксируйте поступление денег: оплату по проекту, консультацию, продажу — что угодно."
          }
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="За что?">
            <Input
              placeholder="например, Консультация для Acme — июнь"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </Field>

          <div>
            <label className="block text-[12px] font-medium text-ink-2 mb-1.5">
              Категория
            </label>
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {QUICK_TYPES.map((k) => {
                const m = allKnownIncomeTypes().find((mm) => mm.key === k);
                if (!m) return null;
                const isActive = type === m.key;
                return (
                  <button
                    type="button"
                    key={m.key}
                    onClick={() => setType(m.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] border transition-colors",
                      isActive
                        ? "bg-accent-soft border-accent/40 text-accent-ink"
                        : "bg-canvas border-hairline-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2"
                    )}
                  >
                    <span className="text-[13px] leading-none" aria-hidden>
                      {m.icon}
                    </span>
                    {m.label}
                  </button>
                );
              })}
            </div>
            <select
              className="h-9 w-full bg-canvas border border-hairline-strong rounded-md px-3 text-[14px] text-ink hover:border-ink-5 focus:border-accent focus:shadow-[0_0_0_3px_rgba(35,131,226,0.18)] outline-none transition-all cursor-pointer"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {allKnownIncomeTypes().map((m) => (
                <option key={m.key} value={m.key}>
                  {m.icon}  {m.label}
                </option>
              ))}
            </select>
          </div>

          <Field label="Сумма">
            <div className="relative">
              <span
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-ink-3 font-medium"
                aria-hidden
              >
                ₸
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-7 pr-16 font-mono text-[15px] tabular-nums"
                required
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-4 uppercase tracking-[0.08em]">
                ₸
              </span>
            </div>
          </Field>

          <WalletPicker label="Куда зачислить" value={wallet} onChange={setWallet} />

          <Field label="Заметка">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Необязательно — источник, договор, контакт"
            />
          </Field>

          <div className="flex items-center gap-2 px-3 py-2 bg-surface border border-hairline rounded-md text-[12px] text-ink-3">
            <span className="text-[14px] leading-none" aria-hidden>
              {meta.icon}
            </span>
            <span className="text-ink-2">
              Сохранится как{" "}
              <strong className="text-ink font-medium">{meta.label}</strong>
            </span>
            <span
              className="h-1.5 w-1.5 rounded-full ml-1"
              style={{ background: meta.color }}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={mutation.isPending || !name || !amount}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Сохраняем…
                </>
              ) : (
                <>
                  {initial ? null : <Plus className="h-3.5 w-3.5" />}
                  {initial ? "Сохранить" : "Записать"}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
