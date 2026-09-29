"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Topbar } from "@/components/app-shell/topbar";
import { Panel, PanelHeader, PanelTitle, PanelBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { spendings, wallets } from "@/lib/endpoints";
import { usePagedList } from "@/lib/use-paged-list";
import { LoadMore } from "@/components/load-more";
import { WalletBreakdown } from "@/components/wallet-breakdown";
import { typeMetaForSpending } from "@/lib/spending-type-meta";
import { formatCurrency, formatDate, cn, plural } from "@/lib/utils";
import { asApiError } from "@/lib/api";
import { useChartColors } from "@/lib/use-chart-colors";
import { useHasPermission, useIsSuperuser, useRole } from "@/lib/permissions";
import { PermissionDenied } from "@/components/permission-gate";
import { SpendingFormDialog } from "./spending-form-dialog";
import type { Spending, SpendingFilters } from "@/lib/types";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  X,
  Wallet as WalletIcon,
} from "lucide-react";

function colorFor(type: string): string {
  return typeMetaForSpending(type).color;
}

function iconFor(type: string): string {
  return typeMetaForSpending(type).icon;
}

function labelFor(type: string): string {
  return typeMetaForSpending(type).label;
}

export default function SpendingsPage() {
  const role = useRole();
  const isSuper = useIsSuperuser();
  const access = useHasPermission("accounting_can_retrieve");
  const canCreate = useHasPermission("accounting_can_create");
  const canUpdate = useHasPermission("accounting_can_update");
  const canDelete = useHasPermission("accounting_can_delete");
  const allowed = isSuper || (role === "employee" && access.granted);
  const canCreateEntry = isSuper || canCreate.granted;
  const canUpdateEntry = isSuper || canUpdate.granted;
  const canDeleteEntry = isSuper || canDelete.granted;

  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [activeWallet, setActiveWallet] = useState<number | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const c = useChartColors();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters: SpendingFilters = useMemo(
    () => ({
      type: activeType ?? undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      wallet: activeWallet ?? undefined,
      search: debouncedSearch || undefined,
    }),
    [activeType, fromDate, toDate, activeWallet, debouncedSearch]
  );

  const paged = usePagedList({
    queryKey: ["spendings", "paged", filters],
    fetchPage: (page) => spendings.page(filters, page),
    enabled: allowed,
  });
  const listQ = paged.query;

  const walletsQ = useQuery({
    queryKey: ["wallets"],
    queryFn: wallets.list,
    enabled: allowed,
  });

  const analyticsQ = useQuery({
    queryKey: ["spendings-analytics", filters],
    queryFn: () => spendings.analytics(filters),
    enabled: allowed,
  });

  // Filters and search run on the server; pages are appended on demand.
  const filtered = paged.items;

  const analytics = analyticsQ.data;
  const totalAmount = Number(analytics?.total.total_amount ?? 0);
  const totalCount = analytics?.total.count ?? 0;

  const byType = useMemo(() => {
    return (analytics?.by_type ?? [])
      .map((b) => ({ name: b.type, value: Number(b.total_amount) }))
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [analytics]);

  const runwayData = useMemo(
    () =>
      (analytics?.by_date ?? [])
        .slice()
        .sort((a, b) => a.date_spend.localeCompare(b.date_spend))
        .map((d) => ({
          d: d.date_spend.slice(5),
          v: Number(d.total_amount),
        })),
    [analytics]
  );

  const filtersActive = Boolean(
    activeType || fromDate || toDate || search || activeWallet
  );

  if (!allowed) {
    return (
      <>
        <Topbar eyebrow="Финансы" title="Расходы" />
        <PermissionDenied
          title="Доступ к расходам ограничен"
          detail={
            role === "collaborator"
              ? "Эту страницу видят только сотрудники Qoima с доступом к бухгалтерии."
              : "У вашей учётной записи нет права «accounting_can_retrieve». Попросите администратора выдать его."
          }
        />
      </>
    );
  }

  return (
    <>
      <Topbar
        eyebrow="Финансы"
        title="Расходы"
        actions={
          canCreateEntry ? (
            <SpendingFormDialog
              trigger={
                <Button variant="primary" size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  Записать расход
                </Button>
              }
            />
          ) : undefined
        }
      />
      <main className="flex-1 px-4 sm:px-6 lg:px-10 py-6 sm:py-10 max-w-[1280px] mx-auto w-full">
        <header className="mb-8 anim-rise">
          <h1 className="font-display text-[28px] tracking-tight text-ink">
            Расходы
          </h1>
          <p className="mt-2 text-[14px] text-ink-3">
            Все траты компании в одном месте — по категориям и с поиском.
          </p>
        </header>

        {/* Summary */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 stagger">
          <Stat
            label={filtersActive ? "По фильтру" : "Всего потрачено"}
            value={formatCurrency(totalAmount)}
            accent
          />
          <Stat label="Записей" value={String(totalCount)} />
          <Stat
            label="Средний чек"
            value={formatCurrency(
              totalCount > 0 ? totalAmount / totalCount : 0
            )}
          />
          <Stat
            label="Самый крупный"
            value={formatCurrency(Number(analytics?.total.max_amount ?? 0))}
          />
        </section>

        <WalletBreakdown
          rows={analytics?.by_wallet ?? []}
          wallets={walletsQ.data ?? []}
          active={activeWallet}
          onSelect={setActiveWallet}
          verb="потрачено"
        />

        {/* Filters row */}
        <section className="flex flex-col md:flex-row md:items-end gap-3 mb-6 anim-fade">
          <div className="flex-1 max-w-md relative">
            <Search className="absolute left-3 top-[34px] h-4 w-4 text-ink-4 pointer-events-none" />
            <label className="text-[12px] font-medium text-ink-2 mb-1.5 block">
              Поиск
            </label>
            <Input
              placeholder="Название, категория или заметка"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="w-full md:w-auto">
            <label className="text-[12px] font-medium text-ink-2 mb-1.5 block">
              С даты
            </label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full md:w-[160px]"
            />
          </div>
          <div className="w-full md:w-auto">
            <label className="text-[12px] font-medium text-ink-2 mb-1.5 block">
              По дату
            </label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full md:w-[160px]"
            />
          </div>
          {filtersActive && (
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                setActiveType(null);
                setFromDate("");
                setToDate("");
                setSearch("");
                setActiveWallet(null);
              }}
            >
              <X className="h-3.5 w-3.5" />
              Сбросить
            </Button>
          )}
        </section>

        {/* Error state */}
        {listQ.isError && (
          <Panel className="p-6 mb-6 anim-fade">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 grid place-items-center bg-tag-red-bg text-tag-red-fg rounded-md">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <h3 className="text-[14px] text-ink font-medium">
                  Не удалось загрузить расходы
                </h3>
                <p className="text-[13px] text-ink-3 mt-1">
                  {asApiError(listQ.error).message}
                </p>
                <p className="text-[12px] font-mono text-ink-4 mt-3">
                  GET /api/spendings/
                </p>
              </div>
            </div>
          </Panel>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.4fr] gap-4 mb-6">
          <Panel>
            <PanelHeader>
              <PanelTitle>По категориям</PanelTitle>
              <span className="text-[12px] text-ink-3">
                {byType.length} {plural(byType.length, "категория", "категории", "категорий")}
              </span>
            </PanelHeader>
            <PanelBody>
              {byType.length === 0 ? (
                <p className="text-[13px] text-ink-4 text-center py-10">
                  Нет данных для отображения
                </p>
              ) : (
                <div className="flex flex-col xl:flex-row items-center gap-6">
                  <div className="h-[160px] w-[160px] sm:h-[200px] sm:w-[200px] relative shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={byType}
                          innerRadius={64}
                          outerRadius={90}
                          paddingAngle={2}
                          dataKey="value"
                          stroke="none"
                        >
                          {byType.map((d) => (
                            <Cell key={d.name} fill={colorFor(d.name)} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: c.canvas,
                            border: `1px solid ${c.hairlineStrong}`,
                            borderRadius: 8,
                            fontSize: 12,
                            color: c.ink,
                          }}
                          formatter={(v) => formatCurrency(Number(v))}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 grid place-items-center pointer-events-none">
                      <div className="text-center">
                        <div className="text-[11px] text-ink-3">Всего</div>
                        <div className="font-display text-[20px] tabular-nums text-ink mt-1">
                          {totalAmount >= 1000
                            ? `${(totalAmount / 1000).toFixed(1)}k`
                            : formatCurrency(totalAmount)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <ul className="flex-1 w-full space-y-1.5">
                    {byType.map((b) => {
                      const pct =
                        totalAmount > 0 ? (b.value / totalAmount) * 100 : 0;
                      const isActive = activeType === b.name;
                      return (
                        <li key={b.name}>
                          <button
                            onClick={() =>
                              setActiveType(isActive ? null : b.name)
                            }
                            className={cn(
                              "w-full flex items-center justify-between px-3 h-9 text-left transition-colors rounded-md min-w-0",
                              isActive
                                ? "bg-accent-soft text-ink"
                                : "hover:bg-surface-2 text-ink-2"
                            )}
                          >
                            <span className="flex items-center gap-2 text-[13px] min-w-0">
                              <span
                                className="text-[14px] leading-none"
                                aria-hidden
                              >
                                {iconFor(b.name)}
                              </span>
                              <span
                                className="h-1.5 w-1.5 rounded-full shrink-0"
                                style={{ background: colorFor(b.name) }}
                              />
                              <span className="text-ink truncate">
                                {labelFor(b.name)}
                              </span>
                            </span>
                            <span className="flex items-center gap-3 text-[12px] tabular-nums">
                              <span className="text-ink-3">
                                {pct.toFixed(0)}%
                              </span>
                              <span className="text-ink">
                                {formatCurrency(b.value)}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitle>Динамика расходов</PanelTitle>
              <span className="text-[12px] text-ink-3">
                {runwayData.length} {plural(runwayData.length, "день", "дня", "дней")}
              </span>
            </PanelHeader>
            <PanelBody>
              {runwayData.length === 0 ? (
                <p className="text-[13px] text-ink-4 text-center py-16">
                  Нет данных для отображения
                </p>
              ) : (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={runwayData}
                      margin={{ top: 10, right: 4, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="spendfill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={c.accent}
                            stopOpacity={0.22}
                          />
                          <stop
                            offset="100%"
                            stopColor={c.accent}
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={c.hairline} vertical={false} />
                      <XAxis
                        dataKey="d"
                        stroke={c.ink4}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke={c.ink4}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                      />
                      <Tooltip
                        cursor={{ stroke: c.accent, strokeWidth: 1 }}
                        contentStyle={{
                          background: c.canvas,
                          border: `1px solid ${c.hairlineStrong}`,
                          borderRadius: 8,
                          fontSize: 12,
                          color: c.ink,
                        }}
                        formatter={(v) => formatCurrency(Number(v))}
                      />
                      <Area
                        type="monotone"
                        dataKey="v"
                        stroke={c.accent}
                        strokeWidth={2}
                        fill="url(#spendfill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </PanelBody>
          </Panel>
        </div>

        {/* Ledger */}
        <Panel>
          <PanelHeader>
            <PanelTitle>Все расходы</PanelTitle>
            <span className="text-[12px] text-ink-3">
              {listQ.isLoading
                ? "Загрузка…"
                : `${paged.total} ${plural(
                    paged.total,
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
                <TH>Категория</TH>
                <TH className="hidden sm:table-cell">Кошелёк</TH>
                <TH className="text-right">Сумма</TH>
                <TH className="hidden md:table-cell">Дата</TH>
                <TH className="hidden md:table-cell">Заметка</TH>
                <TH className="w-20"></TH>
              </TR>
            </THead>
            <tbody>
              {filtered.map((s) => (
                <SpendingRow
                  key={s.id}
                  s={s}
                  canEdit={canUpdateEntry}
                  canDelete={canDeleteEntry}
                />
              ))}
              {!listQ.isLoading && filtered.length === 0 && (
                <TR>
                  <TD colSpan={7} className="text-center text-ink-4 py-12">
                    Ничего не найдено.
                  </TD>
                </TR>
              )}
            </tbody>
          </Table>
          <LoadMore
            shown={filtered.length}
            total={paged.total}
            hasMore={paged.hasMore}
            onMore={paged.loadMore}
            onAll={paged.loadAll}
            loading={paged.isLoadingMore}
          />
        </Panel>
      </main>
    </>
  );
}

function SpendingRow({
  s,
  canEdit,
  canDelete,
}: {
  s: Spending;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => spendings.remove(s.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["spendings"] });
      qc.invalidateQueries({ queryKey: ["spendings-analytics"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["wallets-logs"] });
      qc.invalidateQueries({ queryKey: ["wallets-analytics"] });
      toast.success("Запись удалена.");
    },
    onError: (err) => toast.error(asApiError(err).message),
  });

  const showActions = canEdit || canDelete;

  return (
    <TR>
      <TD className="text-ink">{s.name}</TD>
      <TD>
        <Badge tone={typeMetaForSpending(s.type).tone}>
          <span className="text-[12px] leading-none" aria-hidden>
            {iconFor(s.type)}
          </span>
          {labelFor(s.type)}
        </Badge>
      </TD>
      <TD className="hidden sm:table-cell">
        {s.wallet_name ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 whitespace-nowrap">
            <WalletIcon className="h-3.5 w-3.5 text-ink-4" />
            {s.wallet_name}
          </span>
        ) : (
          <span className="text-ink-4">—</span>
        )}
      </TD>
      <TD className="text-right font-medium tabular-nums whitespace-nowrap">
        {formatCurrency(s.amount)}
      </TD>
      <TD className="hidden md:table-cell text-ink-3 tabular-nums whitespace-nowrap">{formatDate(s.date_spend)}</TD>
      <TD className="hidden md:table-cell text-ink-3 max-w-[140px] sm:max-w-[280px] truncate">{s.note || "—"}</TD>
      <TD>
        {showActions && (
          <div className="flex items-center justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            {canEdit && (
              <SpendingFormDialog
                initial={s}
                trigger={
                  <button
                    title="Редактировать"
                    className="h-7 w-7 grid place-items-center rounded text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                }
              />
            )}
            {canDelete && (
              <button
                title="Удалить"
                onClick={() => {
                  if (confirm(`Удалить «${s.name}»?`)) del.mutate();
                }}
                disabled={del.isPending}
                className="h-7 w-7 grid place-items-center rounded text-ink-3 hover:text-danger hover:bg-tag-red-bg/30 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </TD>
    </TR>
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
