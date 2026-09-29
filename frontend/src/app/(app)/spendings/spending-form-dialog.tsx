"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field, Textarea } from "@/components/ui/input";
import { TypeCombobox } from "@/components/ui/type-combobox";
import { WalletPicker } from "@/components/wallet-picker";
import { spendings } from "@/lib/endpoints";
import { asApiError } from "@/lib/api";
import {
  allKnownTypes,
  rememberType,
  typeMetaForSpending,
} from "@/lib/spending-type-meta";
import type { Spending } from "@/lib/types";
import { Loader2, Plus, Receipt } from "lucide-react";

const schema = z.object({
  name: z.string().min(1, "Укажите название."),
  type: z.string().min(1, "Выберите категорию."),
  amount: z
    .string()
    .min(1, "Введите сумму.")
    .refine((v) => !Number.isNaN(Number(v)) && Number(v) > 0, {
      message: "Сумма должна быть положительной.",
    }),
  note: z.string().optional(),
  wallet: z.number().nullable(),
});

type FormValues = z.infer<typeof schema>;

/**
 * Frequent categories shown as one-tap chips above the combobox.
 * Picked from the preset list, ordered by what's typically high-volume
 * for a small services company.
 */
const QUICK_TYPES = ["infrastructure", "tooling", "office", "travel"] as const;

export function SpendingFormDialog({
  trigger,
  initial,
}: {
  trigger: React.ReactNode;
  initial?: Spending;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nameRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      name: initial?.name ?? "",
      type: initial?.type ?? "infrastructure",
      amount: initial?.amount ?? "",
      note: initial?.note ?? "",
      wallet: initial?.wallet ?? null,
    },
  });

  // useWatch is the compiler-friendly alternative to watch() — it subscribes
  // through Controller-like internals instead of re-rendering on each keystroke.
  const currentType = useWatch({ control, name: "type" });
  const amountValue = useWatch({ control, name: "amount" });
  const amountPreview =
    amountValue && !Number.isNaN(Number(amountValue))
      ? Number(amountValue)
      : null;

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        name: values.name.trim(),
        type: values.type.trim(),
        amount: values.amount,
        note: values.note?.trim() || undefined,
        wallet: values.wallet,
      };
      return initial
        ? spendings.update(initial.id, payload)
        : spendings.create(payload);
    },
    onSuccess: (saved, vars) => {
      qc.invalidateQueries({ queryKey: ["spendings"] });
      qc.invalidateQueries({ queryKey: ["spendings-analytics"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["wallets-current"] });
      qc.invalidateQueries({ queryKey: ["wallets-logs"] });
      qc.invalidateQueries({ queryKey: ["wallets-analytics"] });
      rememberType(vars.type);
      toast.success(
        initial
          ? "Запись обновлена."
          : `Расход записан${saved.wallet_name ? ` · ${saved.wallet_name}` : ""}.`
      );
      setOpen(false);
      if (!initial)
        reset({
          name: "",
          type: "infrastructure",
          amount: "",
          note: "",
          wallet: vars.wallet,
        });
    },
    onError: (err) => toast.error(asApiError(err).message),
  });

  // Auto-focus the Name field when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setFocus("name"), 60);
    return () => clearTimeout(t);
  }, [open, setFocus]);

  // ⌘/Ctrl+Enter submits from anywhere inside the form.
  function handleFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit((v) => mutation.mutate(v))();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)}>{trigger}</div>
      <DialogContent className="max-w-[520px]">
        <DialogHeader
          eyebrow={initial ? "Финансы · Изменить" : "Финансы · Новый"}
          title={
            <span className="flex items-center gap-2.5">
              <span className="h-9 w-9 grid place-items-center bg-accent-soft text-accent-ink rounded-md">
                <Receipt className="h-4 w-4" />
              </span>
              <span>{initial ? "Редактировать расход" : "Записать расход"}</span>
            </span>
          }
          description={
            initial
              ? "Обновите данные — дата записи не меняется."
              : "Зафиксируйте трату — она попадёт в аналитику, журнал и месячные итоги."
          }
        />

        <form
          onSubmit={handleSubmit((v) => mutation.mutate(v))}
          onKeyDown={handleFormKeyDown}
          className="flex flex-col gap-4"
        >
          <Field label="За что?" hint={errors.name?.message}>
            <Input
              {...register("name", {
                onChange: () => null,
              })}
              ref={(el) => {
                register("name").ref(el);
                nameRef.current = el;
              }}
              placeholder="например, AWS — счёт за май"
              aria-invalid={!!errors.name}
              autoComplete="off"
            />
          </Field>

          {/* Quick category chips */}
          <div>
            <label className="block text-[12px] font-medium text-ink-2 mb-1.5">
              Категория
            </label>
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {QUICK_TYPES.map((k) => {
                const meta = allKnownTypes().find((m) => m.key === k);
                if (!meta) return null;
                const isActive =
                  currentType.toLowerCase() === meta.key.toLowerCase();
                return (
                  <button
                    type="button"
                    key={meta.key}
                    onClick={() =>
                      setValue("type", meta.key, { shouldValidate: true })
                    }
                    className={
                      "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] border transition-colors " +
                      (isActive
                        ? "bg-accent-soft border-accent/40 text-accent-ink"
                        : "bg-canvas border-hairline-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2")
                    }
                  >
                    <span className="text-[13px] leading-none" aria-hidden>
                      {meta.icon}
                    </span>
                    {meta.label}
                  </button>
                );
              })}
              <span className="text-[11px] text-ink-4 ml-1">или</span>
            </div>
            <Controller
              control={control}
              name="type"
              render={({ field, fieldState }) => (
                <TypeCombobox
                  value={field.value}
                  onChange={(v) => field.onChange(v)}
                  invalid={!!fieldState.error}
                />
              )}
            />
            {errors.type?.message && (
              <p className="mt-1.5 text-[12px] text-ink-3">
                {errors.type.message}
              </p>
            )}
          </div>

          {/* Amount with ₸ adornment + live preview */}
          <Field label="Сумма" hint={errors.amount?.message}>
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
                className="pl-7 pr-16 font-mono text-[15px] tabular-nums"
                aria-invalid={!!errors.amount}
                {...register("amount")}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-4 uppercase tracking-[0.08em]">
                ₸
              </span>
            </div>
            {amountPreview !== null && amountPreview > 0 && (
              <p className="mt-1.5 text-[12px] text-ink-3">
                {new Intl.NumberFormat("ru-RU", {
                  style: "currency",
                  currency: "KZT",
                  currencyDisplay: "narrowSymbol",
                }).format(amountPreview)}
              </p>
            )}
          </Field>

          <Controller
            control={control}
            name="wallet"
            render={({ field }) => (
              <WalletPicker
                label="Откуда списать"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />

          <Field label="Заметка">
            <Textarea
              {...register("note")}
              rows={3}
              placeholder="Необязательно — поставщик, номер счёта или что-то важное"
            />
          </Field>

          {/* Selected category preview row */}
          {currentType && (
            <div className="flex items-center gap-2 px-3 py-2 bg-surface border border-hairline rounded-md text-[12px] text-ink-3">
              <span className="text-[14px] leading-none" aria-hidden>
                {typeMetaForSpending(currentType).icon}
              </span>
              <span className="text-ink-2">
                Сохранится как <strong className="text-ink font-medium">
                  {typeMetaForSpending(currentType).label}
                </strong>
              </span>
              <span
                className="h-1.5 w-1.5 rounded-full ml-1"
                style={{ background: typeMetaForSpending(currentType).color }}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-hairline">
            <span className="text-[11px] text-ink-4 hidden sm:flex items-center gap-1.5">
              <kbd className="px-1 py-px text-[10px] bg-canvas border border-hairline rounded font-mono">
                ⌘
              </kbd>
              <kbd className="px-1 py-px text-[10px] bg-canvas border border-hairline rounded font-mono">
                ↵
              </kbd>
              — сохранить
            </span>
            <div className="flex items-center gap-2 ml-auto">
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
                disabled={mutation.isPending || isSubmitting}
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
