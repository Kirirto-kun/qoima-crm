"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field, Textarea } from "@/components/ui/input";
import { WalletPicker } from "@/components/wallet-picker";
import { wallets } from "@/lib/endpoints";
import { asApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { ArrowLeftRight, Loader2 } from "lucide-react";

function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function TransferDialog({
  trigger,
  defaultFrom,
}: {
  trigger: React.ReactNode;
  defaultFrom?: number;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const [from, setFrom] = useState<number | null>(defaultFrom ?? null);
  const [to, setTo] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");

  const listQ = useQuery({ queryKey: ["wallets"], queryFn: wallets.list, enabled: open });
  const fromWallet = listQ.data?.find((w) => w.id === from);

  // Pre-select a destination different from the source.
  const pickTo = (id: number) => setTo(id);
  const pickFrom = (id: number) => {
    setFrom(id);
    if (to === id) setTo(null);
  };
  const toCandidate =
    to ?? listQ.data?.find((w) => w.is_active && w.id !== from)?.id ?? null;

  const mutation = useMutation({
    mutationFn: () =>
      wallets.transfers.create({
        from_wallet: from as number,
        to_wallet: toCandidate as number,
        amount,
        date,
        note: note.trim() || undefined,
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["wallets-current"] });
      qc.invalidateQueries({ queryKey: ["wallets-logs"] });
      qc.invalidateQueries({ queryKey: ["wallets-analytics"] });
      qc.invalidateQueries({ queryKey: ["wallets-transfers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-analytics"] });
      toast.success(`Переведено: ${t.from_wallet_name} → ${t.to_wallet_name}`);
      setOpen(false);
      setAmount("");
      setNote("");
    },
    onError: (err) => toast.error(asApiError(err).message),
  });

  const invalid =
    !from || !toCandidate || from === toCandidate || !amount || Number(amount) <= 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)}>{trigger}</div>
      <DialogContent className="max-w-[560px]">
        <DialogHeader
          eyebrow="Кошелёк · Перевод"
          title={
            <span className="flex items-center gap-2.5">
              <span className="h-9 w-9 grid place-items-center bg-tag-purple-bg text-tag-purple-fg rounded-md">
                <ArrowLeftRight className="h-4 w-4" />
              </span>
              <span>Перевод между кошельками</span>
            </span>
          }
          description="Например, сняли наличные со счёта. Общая сумма денег не меняется — только их место."
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) mutation.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <WalletPicker label="Откуда" value={from} onChange={pickFrom} />
          <WalletPicker label="Куда" value={toCandidate} onChange={pickTo} />
          {from != null && from === toCandidate && (
            <p className="-mt-2 text-[12px] text-danger">
              Выберите разные кошельки.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-3">
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
                  className="pl-7 font-mono text-[15px] tabular-nums"
                  required
                />
              </div>
              {fromWallet?.can_view_balance && (
                <p className="mt-1.5 text-[12px] text-ink-3">
                  Доступно в «{fromWallet.name}»: {formatCurrency(fromWallet.balance)}
                </p>
              )}
            </Field>
            <Field label="Дата">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <Field label="Заметка">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Необязательно — например, сняли в банкомате"
            />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline">
            <Button type="button" variant="ghost" size="md" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={invalid || mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Переводим…
                </>
              ) : (
                <>
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  Перевести
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
