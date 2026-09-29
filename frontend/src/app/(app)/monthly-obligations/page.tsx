"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Topbar } from "@/components/app-shell/topbar";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { PermissionDenied } from "@/components/permission-gate";
import { monthlyObligations } from "@/lib/endpoints";
import { asApiError } from "@/lib/api";
import { useHasPermission, useIsSuperuser, useRole } from "@/lib/permissions";
import { cn, formatCurrency, formatDate, plural } from "@/lib/utils";
import type { MonthlyObligation, MonthlyObligationCreate } from "@/lib/types";
import {
  Ban,
  Bot,
  CalendarClock,
  CheckCircle2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { WalletPicker } from "@/components/wallet-picker";

const TYPE_SUGGESTIONS = [
  "Зарплаты",
  "ИИ сервисы",
  "Аренда офиса",
  "SaaS подписки",
  "Инфраструктура",
];

function typeTone(type: string): "green" | "blue" | "orange" | "gray" {
  const normalized = type.toLowerCase();

  if (normalized.includes("зар")) return "green";
  if (
    normalized.includes("ии") ||
    normalized.includes("ai") ||
    normalized.includes("сервис") ||
    normalized.includes("saas")
  ) {
    return "blue";
  }
  if (normalized.includes("арен") || normalized.includes("офис")) return "orange";

  return "gray";
}

function TypeBadge({ type }: { type: string }) {
  const Icon = typeTone(type) === "blue" ? Bot : Tag;

  return (
    <Badge tone={typeTone(type)}>
      <Icon className="h-3 w-3" />
      {type}
    </Badge>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function daysUntilLabel(value: string) {
  const dueDate = parseLocalDate(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Math.max(0, Math.ceil((dueDate.getTime() - today.getTime()) / DAY_MS));

  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";

  return `через ${days} ${plural(days, "день", "дня", "дней")}`;
}

export default function MonthlyObligationsPage() {
  const role = useRole();
  const isSuper = useIsSuperuser();
  const canRead = useHasPermission("accounting_can_retrieve");
  const canCreate = useHasPermission("accounting_can_create");
  const canUpdate = useHasPermission("accounting_can_update");
  const canDelete = useHasPermission("accounting_can_delete");
  const allowed = isSuper || (role === "employee" && canRead.granted);
  const canCreateEntry = isSuper || canCreate.granted;
  const canUpdateEntry = isSuper || canUpdate.granted;
  const canDeleteEntry = isSuper || canDelete.granted;
  const [search, setSearch] = useState("");

  const listQ = useQuery({
    queryKey: ["monthly-obligations"],
    queryFn: () => monthlyObligations.list(),
    enabled: allowed,
  });
  const analyticsQ = useQuery({
    queryKey: ["monthly-obligations-analytics"],
    queryFn: monthlyObligations.analytics,
    enabled: allowed,
  });

  const items = useMemo(() => listQ.data ?? [], [listQ.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        item.type.toLowerCase().includes(term) ||
        item.note.toLowerCase().includes(term)
    );
  }, [items, search]);

  const active = items.filter((item) => item.is_active);
  const visibleTypes = Array.from(new Set(active.map((item) => item.type))).slice(0, 4);
  const monthlyMinimum = Number(
    analyticsQ.data?.total.total_amount ??
      active.reduce((sum, item) => sum + Number(item.amount), 0)
  );
  const activeCount = analyticsQ.data?.total.count ?? active.length;
  const nextDue = active
    .slice()
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

  if (!allowed) {
    return (
      <>
        <Topbar eyebrow="Компания" title="Обязательные расходы" />
        <PermissionDenied
          title="Доступ к обязательным расходам ограничен"
          detail="Эту страницу видят только сотрудники с доступом к бухгалтерии."
        />
      </>
    );
  }

  return (
    <>
      <Topbar
        eyebrow="Компания"
        title="Обязательные расходы"
        actions={
          canCreateEntry ? (
            <MonthlyObligationDialog
              trigger={
                <Button variant="primary" size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  Добавить
                </Button>
              }
            />
          ) : undefined
        }
      />
      <main className="flex-1 px-4 sm:px-6 lg:px-10 py-6 sm:py-10 max-w-[1180px] mx-auto w-full">
        <header className="mb-8 anim-rise">
          <h1 className="font-display text-[28px] tracking-tight text-ink">
            Ежемесячный минимум компании
          </h1>
          <p className="mt-2 text-[14px] text-ink-3 max-w-[68ch]">
            Зарплаты, ИИ сервисы, аренда офиса и другие обязательные суммы,
            без которых компания не может стабильно работать.
          </p>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 stagger">
          <Stat label="Минимум в месяц" value={formatCurrency(monthlyMinimum)} accent />
          <Stat
            label="Активные статьи"
            value={`${activeCount} ${plural(activeCount, "статья", "статьи", "статей")}`}
          />
          <Stat
            label="Ближайшая дата"
            value={nextDue ? formatDate(nextDue.due_date) : "—"}
          />
        </section>

        <Panel className="mb-6">
          <PanelBody>
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1 max-w-md relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-4 pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по названию, типу или заметке"
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {(visibleTypes.length ? visibleTypes : TYPE_SUGGESTIONS.slice(0, 3)).map(
                  (type) => (
                    <TypeBadge key={type} type={type} />
                  )
                )}
              </div>
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Таблица обязательных расходов</PanelTitle>
            <span className="text-[12px] text-ink-3">
              {listQ.isLoading
                ? "Загрузка…"
                : `${filtered.length} ${plural(
                    filtered.length,
                    "запись",
                    "записи",
                    "записей"
                  )}`}
            </span>
          </PanelHeader>
          <Table>
            <THead>
              <TR>
                <TH>Название</TH>
                <TH>Тип</TH>
                <TH className="text-right">Минимальная сумма</TH>
                <TH className="hidden md:table-cell">Списание</TH>
                <TH className="hidden lg:table-cell">Заметка</TH>
                <TH className="w-32"></TH>
              </TR>
            </THead>
            <tbody>
              {filtered.map((item) => (
                <MonthlyObligationRow
                  key={item.id}
                  item={item}
                  canEdit={canUpdateEntry}
                  canDelete={canDeleteEntry}
                />
              ))}
              {!listQ.isLoading && filtered.length === 0 && (
                <TR>
                  <TD colSpan={6} className="text-center text-ink-4 py-12">
                    Обязательные расходы пока не добавлены.
                  </TD>
                </TR>
              )}
            </tbody>
          </Table>
        </Panel>
      </main>
    </>
  );
}

function MonthlyObligationRow({
  item,
  canEdit,
  canDelete,
}: {
  item: MonthlyObligation;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (payload: Partial<MonthlyObligationCreate>) =>
      monthlyObligations.update(item.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monthly-obligations"] });
      qc.invalidateQueries({ queryKey: ["monthly-obligations-analytics"] });
      toast.success("Статус обновлён.");
    },
    onError: (err) => toast.error(asApiError(err).message),
  });
  const exclusion = useMutation({
    mutationFn: () =>
      item.is_excluded_current_month
        ? monthlyObligations.clearCurrentMonthExclusion(item.id)
        : monthlyObligations.excludeCurrentMonth(item.id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["monthly-obligations"] });
      qc.invalidateQueries({ queryKey: ["monthly-obligations-analytics"] });
      qc.invalidateQueries({ queryKey: ["spendings"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["wallets-logs"] });
      qc.invalidateQueries({ queryKey: ["wallets-analytics"] });
      toast.success(
        item.is_excluded_current_month
          ? "Исключение отменено."
          : result.removed_spending_id
            ? "Исключено: расход удалён, кошелёк обновлён."
            : "Исключено на текущий месяц."
      );
    },
    onError: (err) => toast.error(asApiError(err).message),
  });
  const del = useMutation({
    mutationFn: () => monthlyObligations.remove(item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monthly-obligations"] });
      qc.invalidateQueries({ queryKey: ["monthly-obligations-analytics"] });
      toast.success("Запись удалена.");
    },
    onError: (err) => toast.error(asApiError(err).message),
  });

  return (
    <TR className={cn(!item.is_active && "opacity-55")}>
      <TD>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-ink font-medium truncate">{item.name}</span>
          {item.is_active ? (
            <Badge tone="green">Активно</Badge>
          ) : (
            <Badge tone="gray">Выключено</Badge>
          )}
          {item.is_excluded_current_month && (
            <Badge tone="orange">Исключено</Badge>
          )}
        </div>
      </TD>
      <TD>
        <TypeBadge type={item.type} />
      </TD>
      <TD className="text-right font-medium tabular-nums">
        {formatCurrency(item.amount)}
      </TD>
      <TD className="hidden md:table-cell text-ink-3">
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 tabular-nums text-ink-2">
            <CalendarClock className="h-3 w-3" />
            {item.charge_day} число · {daysUntilLabel(item.due_date)}
          </span>
          <span className="text-[12px] tabular-nums">
            след. {formatDate(item.due_date)}
            {item.wallet_name ? ` · ${item.wallet_name}` : ""}
          </span>
        </div>
      </TD>
      <TD className="hidden lg:table-cell text-ink-3 max-w-[280px] truncate">
        {item.note || "—"}
      </TD>
      <TD>
        <div className="flex items-center justify-end gap-1">
          {canEdit && (
            <>
              <button
                title={
                  item.is_excluded_current_month
                    ? "Отменить исключение"
                    : "Исключить текущий месяц"
                }
                onClick={() => exclusion.mutate()}
                disabled={exclusion.isPending}
                className="h-7 w-7 grid place-items-center rounded text-ink-3 hover:text-orange-600 hover:bg-tag-orange-bg/40 transition-colors"
              >
                {item.is_excluded_current_month ? (
                  <RotateCcw className="h-3.5 w-3.5" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                title={item.is_active ? "Выключить" : "Включить"}
                onClick={() => update.mutate({ is_active: !item.is_active })}
                disabled={update.isPending}
                className="h-7 w-7 grid place-items-center rounded text-ink-3 hover:text-success hover:bg-tag-green-bg/30 transition-colors"
              >
                {item.is_active ? (
                  <X className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
              </button>
              <MonthlyObligationDialog
                initial={item}
                trigger={
                  <button
                    title="Редактировать"
                    className="h-7 w-7 grid place-items-center rounded text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                }
              />
            </>
          )}
          {canDelete && (
            <button
              title="Удалить"
              onClick={() => {
                if (confirm(`Удалить «${item.name}»?`)) del.mutate();
              }}
              disabled={del.isPending}
              className="h-7 w-7 grid place-items-center rounded text-ink-3 hover:text-danger hover:bg-tag-red-bg/30 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </TD>
    </TR>
  );
}

function MonthlyObligationDialog({
  trigger,
  initial,
}: {
  trigger: React.ReactNode;
  initial?: MonthlyObligation;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState(initial?.type ?? "ИИ сервисы");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [chargeDay, setChargeDay] = useState(String(initial?.charge_day ?? 1));
  const [note, setNote] = useState(initial?.note ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [wallet, setWallet] = useState<number | null>(initial?.wallet ?? null);
  const chargeDayNumber = Number(chargeDay);

  const save = useMutation({
    mutationFn: () => {
      const payload: MonthlyObligationCreate = {
        name: name.trim(),
        type: type.trim(),
        amount,
        charge_day: chargeDayNumber,
        is_active: isActive,
        note,
        wallet,
      };
      if (initial && chargeDayNumber === initial.charge_day) {
        payload.due_date = initial.due_date;
      }
      return initial
        ? monthlyObligations.update(initial.id, payload)
        : monthlyObligations.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monthly-obligations"] });
      qc.invalidateQueries({ queryKey: ["monthly-obligations-analytics"] });
      toast.success(initial ? "Запись обновлена." : "Запись добавлена.");
      setOpen(false);
    },
    onError: (err) => toast.error(asApiError(err).message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)}>{trigger}</div>
      <DialogContent className="max-w-[520px]">
        <DialogHeader
          eyebrow="Компания · Минимум"
          title={initial ? "Редактировать статью" : "Добавить обязательный расход"}
          description="Укажите ежемесячную минимальную сумму и день списания."
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Название">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Зарплаты"
              autoFocus
              required
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Тип">
              <Input
                list="monthly-obligation-types"
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="ИИ сервисы"
                required
              />
              <datalist id="monthly-obligation-types">
                {TYPE_SUGGESTIONS.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </Field>
            <Field label="День списания">
              <Input
                type="number"
                min="1"
                max="31"
                value={chargeDay}
                onChange={(e) => setChargeDay(e.target.value)}
                required
              />
            </Field>
          </div>
          <Field label="Минимальная сумма (₸)">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </Field>
          <WalletPicker
            label="Списывать с кошелька"
            value={wallet}
            onChange={setWallet}
          />
          <Field label="Заметка">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Например: OpenAI, Google Workspace, аренда офиса"
            />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            Учитывать в ежемесячном минимуме
          </label>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline">
            <Button type="button" variant="ghost" size="md" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={
                save.isPending ||
                !name.trim() ||
                !type.trim() ||
                !amount ||
                !chargeDay ||
                chargeDayNumber < 1 ||
                chargeDayNumber > 31
              }
            >
              {save.isPending ? "Сохраняем…" : "Сохранить"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-canvas border border-hairline rounded-lg px-4 py-3",
        accent && "bg-accent-soft border-accent/20"
      )}
    >
      <div className="text-[12px] text-ink-3 mb-1">{label}</div>
      <div
        className={cn(
          "font-display text-[18px] sm:text-[22px] tabular-nums break-words",
          accent ? "text-accent-ink" : "text-ink"
        )}
      >
        {value}
      </div>
    </div>
  );
}
