"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { wallets } from "@/lib/endpoints";
import { asApiError } from "@/lib/api";
import type { Wallet } from "@/lib/types";
import { Loader2, Plus, Wallet as WalletIcon } from "lucide-react";

const schema = z.object({
  name: z.string().min(1, "Укажите название."),
  code: z
    .string()
    .max(32, "Не длиннее 32 символов.")
    .regex(/^[\p{L}\p{N}_-]*$/u, "Одно слово: буквы, цифры, - или _."),
  balance: z
    .string()
    .min(1, "Введите начальный остаток.")
    .refine((v) => !Number.isNaN(Number(v)), {
      message: "Сумма должна быть числом.",
    }),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

export function WalletFormDialog({
  trigger,
  initial,
}: {
  trigger: React.ReactNode;
  initial?: Wallet;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const canEditBalance = !initial || initial.can_view_balance;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? "",
      code: initial?.code ?? "",
      balance: initial?.balance ?? "0",
      is_default: initial?.is_default ?? false,
      is_active: initial?.is_active ?? true,
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      name: initial?.name ?? "",
      code: initial?.code ?? "",
      balance: initial?.balance ?? "0",
      is_default: initial?.is_default ?? false,
      is_active: initial?.is_active ?? true,
    });
  }, [open, initial, reset]);

  const isDefault = useWatch({ control, name: "is_default" });
  const isActive = useWatch({ control, name: "is_active" });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        name: values.name.trim(),
        code: values.code.trim().toLowerCase(),
        is_default: values.is_default ?? false,
        is_active: values.is_active ?? true,
      };
      if (canEditBalance) {
        Object.assign(payload, { balance: values.balance });
      }
      return initial
        ? wallets.update(initial.id, payload)
        : wallets.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["wallets-current"] });
      qc.invalidateQueries({ queryKey: ["wallets-logs"] });
      qc.invalidateQueries({ queryKey: ["wallets-analytics"] });
      qc.invalidateQueries({ queryKey: ["dashboard-analytics"] });
      toast.success(initial ? "Кошелёк обновлён." : "Кошелёк создан.");
      setOpen(false);
    },
    onError: (err) => toast.error(asApiError(err).message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)}>{trigger}</div>
      <DialogContent className="max-w-[480px]">
        <DialogHeader
          eyebrow={initial ? "Кошелёк · Изменить" : "Кошелёк · Новый"}
          title={
            <span className="flex items-center gap-2.5">
              <span className="h-9 w-9 grid place-items-center bg-accent-soft text-accent-ink rounded-md">
                <WalletIcon className="h-4 w-4" />
              </span>
              <span>{initial ? "Изменить кошелёк" : "Создать кошелёк"}</span>
            </span>
          }
          description={
            initial
              ? "Изменения зафиксируются в журнале операций."
              : "По умолчанию все доходы и расходы попадают в основной кошелёк."
          }
        />

        <form
          onSubmit={handleSubmit((v) => mutation.mutate(v))}
          className="flex flex-col gap-4"
        >
          <Field label="Название" hint={errors.name?.message}>
            <Input
              {...register("name")}
              placeholder="например, Основной счёт"
              autoFocus
              autoComplete="off"
              aria-invalid={!!errors.name}
            />
          </Field>

          <Field
            label="Код для Telegram"
            hint={
              errors.code?.message ??
              "Короткое слово для бота: /spending 5000 <код> такси. Пусто — создастся из названия."
            }
          >
            <Input
              {...register("code")}
              placeholder="например, cash или kaspi"
              autoComplete="off"
              className="font-mono"
              aria-invalid={!!errors.code}
            />
          </Field>

          <Field
            label={initial ? "Текущий остаток (₸)" : "Начальный остаток (₸)"}
            hint={errors.balance?.message}
          >
            <div className="relative">
              <span
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-ink-3 font-medium"
                aria-hidden
              >
                ₸
              </span>
              {canEditBalance ? (
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="pl-7 font-mono text-[15px] tabular-nums"
                  aria-invalid={!!errors.balance}
                  {...register("balance")}
                />
              ) : (
                <Input
                  value="******"
                  disabled
                  className="pl-7 font-mono text-[15px] tabular-nums"
                />
              )}
            </div>
          </Field>

          <div className="border border-hairline rounded-md divide-y divide-[var(--color-hairline)]">
            <label
              htmlFor="wallet-default"
              className="flex items-center justify-between px-3 h-12 cursor-pointer hover:bg-surface transition-colors"
            >
              <div className="flex flex-col leading-tight">
                <span className="text-[13px] text-ink">Основной кошелёк</span>
                <span className="text-[11px] text-ink-3">
                  Выбирается по умолчанию для новых доходов и расходов
                </span>
              </div>
              <Switch
                id="wallet-default"
                checked={Boolean(isDefault)}
                onCheckedChange={(v) =>
                  setValue("is_default", Boolean(v), { shouldDirty: true })
                }
                disabled={initial?.is_default}
              />
            </label>
            <label
              htmlFor="wallet-active"
              className="flex items-center justify-between px-3 h-12 cursor-pointer hover:bg-surface transition-colors"
            >
              <div className="flex flex-col leading-tight">
                <span className="text-[13px] text-ink">Активный</span>
                <span className="text-[11px] text-ink-3">
                  Отключенные кошельки скрыты из быстрых выборов
                </span>
              </div>
              <Switch
                id="wallet-active"
                checked={Boolean(isActive)}
                onCheckedChange={(v) =>
                  setValue("is_active", Boolean(v), { shouldDirty: true })
                }
              />
            </label>
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
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Сохраняем…
                </>
              ) : initial ? (
                "Сохранить"
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Создать
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
