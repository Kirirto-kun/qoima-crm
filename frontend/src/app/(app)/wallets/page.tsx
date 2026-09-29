"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Topbar } from "@/components/app-shell/topbar";
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { LoadMore } from "@/components/load-more";
import { wallets } from "@/lib/endpoints";
import { asApiError } from "@/lib/api";
import {
  useHasPermission,
  useIsSuperuser,
  useRole,
} from "@/lib/permissions";
import { PermissionDenied } from "@/components/permission-gate";
import { formatCurrency, formatDate, cn, plural } from "@/lib/utils";
import { walletActionMeta } from "@/lib/wallet-labels";
import { userDisplayName } from "@/lib/user-helpers";
import { usePagedList } from "@/lib/use-paged-list";
import { useChartColors } from "@/lib/use-chart-colors";
import { typeMetaForSpending } from "@/lib/spending-type-meta";
import { WalletFormDialog } from "./wallet-form-dialog";
import { TransferDialog } from "./transfer-dialog";
import type {
  Wallet,
  WalletAnalytics,
  WalletAnalyticsRow,
  WalletLog,
  WalletTransfer,
} from "@/lib/types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  History,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Wallet as WalletIcon,
} from "lucide-react";

const MASKED_AMOUNT = "******";

/** Series colours per wallet — same order as the backend (default first). */
const WALLET_COLORS = [
  "#2383e2",
  "#3d9c47",
  "#e08a3a",
  "#7c5cc4",
  "#c95a8b",
  "#a87a55",
  "#c5a23e",
  "#d8473a",
];

function formatProtectedCurrency(
  value: number | string | null | undefined,
  canView: boolean | undefined
) {
  return canView ? formatCurrency(value) : MASKED_AMOUNT;
}

function numericAmount(value: number | string | null | undefined) {
  if (value == null || value === "") return 0;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

type PeriodKey = "month" | "prev" | "quarter" | "year" | "all";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "month", label: "Этот месяц" },
  { key: "prev", label: "Прошлый месяц" },
  { key: "quarter", label: "3 месяца" },
  { key: "year", label: "Год" },
  { key: "all", label: "Всё время" },
];

function iso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function periodRange(key: PeriodKey): { from_date?: string; to_date?: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case "month":
      return { from_date: iso(new Date(y, m, 1)), to_date: iso(now) };
    case "prev":
      return {
        from_date: iso(new Date(y, m - 1, 1)),
        to_date: iso(new Date(y, m, 0)),
      };
    case "quarter":
      return { from_date: iso(new Date(y, m - 2, 1)), to_date: iso(now) };
    case "year":
      return { from_date: iso(new Date(y, 0, 1)), to_date: iso(now) };
    default:
      return {};
  }
}

const selectClass =
  "h-7 bg-canvas border border-hairline-strong rounded-md px-2 text-[12px] text-ink hover:border-ink-5 focus:border-accent outline-none cursor-pointer max-w-[160px]";

export default function WalletsPage() {
  const role = useRole();
  const isSuper = useIsSuperuser();
  const canView = useHasPermission("wallets_can_view_balance");
  const canCreate = useHasPermission("wallets_can_create");
  const canUpdate = useHasPermission("wallets_can_update");
  const canDelete = useHasPermission("wallets_can_delete");

  const permissionsLoading =
    canView.isLoading ||
    canCreate.isLoading ||
    canUpdate.isLoading ||
    canDelete.isLoading;
  const allowed =
    isSuper ||
    (role === "employee" &&
      (canView.granted ||
        canCreate.granted ||
        canUpdate.granted ||
        canDelete.granted));
  const canCreateWallet = isSuper || canCreate.granted;
  const canUpdateWallet = isSuper || canUpdate.granted;
  const canDeleteWallet = isSuper || canDelete.granted;

  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [logWallet, setLogWallet] = useState<number | undefined>(undefined);

  const range = useMemo(() => periodRange(period), [period]);

  const listQ = useQuery({
    queryKey: ["wallets"],
    queryFn: wallets.list,
    enabled: allowed,
  });
  const currentQ = useQuery({
    queryKey: ["wallets-current"],
    queryFn: wallets.current,
    enabled: allowed,
  });
  const analyticsQ = useQuery({
    queryKey: ["wallets-analytics", range],
    queryFn: () => wallets.analytics(range),
    enabled: allowed,
  });
  const logs = usePagedList<WalletLog>({
    queryKey: ["wallets-logs", "paged", logWallet ?? null],
    fetchPage: (page) => wallets.logsPage(logWallet, page),
    enabled: allowed,
  });
  const transfers = usePagedList<WalletTransfer>({
    queryKey: ["wallets-transfers", "paged"],
    fetchPage: (page) => wallets.transfers.page(undefined, page),
    enabled: allowed,
  });

  const allWallets = useMemo(() => listQ.data ?? [], [listQ.data]);
  const analytics = analyticsQ.data;
  const canViewBalances =
    currentQ.data?.can_view_balance ?? allWallets.some((w) => w.can_view_balance);

  const colorById = useMemo(() => {
    const map = new Map<number, string>();
    (analytics?.wallets ?? allWallets).forEach((w, i) =>
      map.set(w.id, WALLET_COLORS[i % WALLET_COLORS.length])
    );
    return map;
  }, [analytics, allWallets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allWallets;
    return allWallets.filter(
      (w) => w.name.toLowerCase().includes(q) || w.code?.toLowerCase().includes(q)
    );
  }, [allWallets, search]);

  const totalBalance = useMemo(
    () =>
      allWallets
        .filter((w) => w.is_active)
        .reduce((acc, w) => acc + numericAmount(w.balance), 0),
    [allWallets]
  );

  const periodNet = numericAmount(analytics?.totals.net);
  const periodLabel = PERIODS.find((p) => p.key === period)?.label.toLowerCase();
  const netCaption = !canViewBalances
    ? MASKED_AMOUNT
    : periodNet === 0
    ? `Без движения · ${periodLabel}`
    : `${periodNet > 0 ? "+" : ""}${formatCurrency(periodNet)} · ${periodLabel}`;

  if (permissionsLoading) {
    return (
      <main className="flex-1 px-4 sm:px-6 lg:px-10 py-10 max-w-[1280px] mx-auto w-full">
        <Panel className="p-12 text-center text-[13px] text-ink-3">
          Проверяем доступ…
        </Panel>
      </main>
    );
  }

  if (!allowed) {
    return (
      <PermissionDenied
        title="У вас нет доступа к этой странице"
        detail="Эту страницу видят только сотрудники с правами кошелька."
      />
    );
  }

  return (
    <>
      <Topbar
        eyebrow="Финансы"
        title="Кошелёк компании"
        actions={
          <div className="flex items-center gap-2">
            {canUpdateWallet && allWallets.filter((w) => w.is_active).length > 1 && (
              <TransferDialog
                trigger={
                  <Button variant="secondary" size="sm">
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Перевод</span>
                  </Button>
                }
              />
            )}
            {canCreateWallet && (
              <WalletFormDialog
                trigger={
                  <Button variant="primary" size="sm">
                    <Plus className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Новый кошелёк</span>
                  </Button>
                }
              />
            )}
          </div>
        }
      />

      <main className="flex-1 px-4 sm:px-6 lg:px-10 py-6 sm:py-10 max-w-[1280px] mx-auto w-full">
        <header className="mb-8 anim-rise">
          <h1 className="font-display text-[28px] tracking-tight text-ink">
            Кошелёк компании
          </h1>
          <p className="mt-2 text-[14px] text-ink-3">
            Деньги компании по кошелькам — наличные, счета, карты. Каждая
            операция списывается или зачисляется в свой кошелёк, а переводы
            перемещают деньги между ними.
          </p>
        </header>

        {/* Current wallet hero + summary */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6 stagger">
          <CurrentWalletCard wallet={currentQ.data} />
          <SummaryCard
            label="Кошельков"
            value={String(allWallets.filter((w) => w.is_active).length)}
            caption={`активных ${plural(
              allWallets.filter((w) => w.is_active).length,
              "счёт",
              "счёта",
              "счетов"
            )} компании`}
            icon={<WalletIcon className="h-3.5 w-3.5" />}
          />
          <SummaryCard
            label="Итого по всем счетам"
            value={formatProtectedCurrency(totalBalance, canViewBalances)}
            caption={netCaption}
            captionPositive={canViewBalances && periodNet > 0}
            captionNegative={canViewBalances && periodNet < 0}
          />
        </section>

        {listQ.isError && (
          <Panel className="p-6 anim-fade mb-6">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 grid place-items-center bg-tag-red-bg text-tag-red-fg rounded-md">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <h3 className="text-[14px] text-ink font-medium">
                  Не удалось загрузить список кошельков
                </h3>
                <p className="text-[13px] text-ink-3 mt-1">
                  {asApiError(listQ.error).message}
                </p>
              </div>
            </div>
          </Panel>
        )}

        {/* Money flow per wallet */}
        <Panel className="mb-6 anim-fade">
          <PanelHeader className="flex-wrap gap-2">
            <PanelTitle eyebrow="Аналитика">Движение по кошелькам</PanelTitle>
            <div className="flex items-center gap-1 flex-wrap">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={cn(
                    "h-7 px-2.5 rounded-md text-[12px] transition-colors",
                    period === p.key
                      ? "bg-ink text-canvas"
                      : "text-ink-3 hover:text-ink hover:bg-surface-2"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </PanelHeader>
          <PanelBody>
            {analyticsQ.isLoading && (
              <p className="text-[13px] text-ink-4 text-center py-10">Считаем…</p>
            )}
            {analytics && (
              <>
                <FlowTotals analytics={analytics} />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
                  {analytics.wallets
                    .filter(
                      (w) =>
                        w.is_active ||
                        w.spending_count > 0 ||
                        w.income_count > 0
                    )
                    .map((w) => (
                      <WalletFlowCard
                        key={w.id}
                        row={w}
                        color={colorById.get(w.id) ?? WALLET_COLORS[0]}
                        canView={analytics.can_view_balance}
                      />
                    ))}
                </div>
                {analytics.can_view_balance && (
                  <FlowChart
                    analytics={analytics}
                    colorById={colorById}
                  />
                )}
              </>
            )}
          </PanelBody>
        </Panel>

        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4 mb-6">
          {/* Wallets list */}
          <Panel className="anim-fade">
            <PanelHeader className="flex-wrap gap-2">
              <PanelTitle>Все кошельки</PanelTitle>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-4" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Найти…"
                  className="h-7 pl-7 text-[12px] w-[120px] sm:w-[180px]"
                />
              </div>
            </PanelHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Название</TH>
                  <TH className="hidden sm:table-cell">Статус</TH>
                  <TH className="text-right">Остаток</TH>
                  <TH className="w-24"></TH>
                </TR>
              </THead>
              <tbody>
                {listQ.isLoading && (
                  <TR>
                    <TD colSpan={4} className="text-center text-ink-4 py-10">
                      Загружаем…
                    </TD>
                  </TR>
                )}
                {!listQ.isLoading && filtered.length === 0 && (
                  <TR>
                    <TD colSpan={4} className="text-center text-ink-4 py-12">
                      {allWallets.length === 0
                        ? "Кошельков пока нет."
                        : "По запросу ничего не нашлось."}
                    </TD>
                  </TR>
                )}
                {filtered.map((w) => (
                  <WalletRow
                    key={w.id}
                    wallet={w}
                    color={colorById.get(w.id)}
                    canEdit={canUpdateWallet}
                    canDelete={canDeleteWallet}
                  />
                ))}
              </tbody>
            </Table>
          </Panel>

          {/* Journal */}
          <Panel className="anim-fade">
            <PanelHeader className="flex-wrap gap-2">
              <PanelTitle eyebrow="Журнал">Операции</PanelTitle>
              <div className="flex items-center gap-2">
                <select
                  className={selectClass}
                  value={logWallet ?? ""}
                  onChange={(e) =>
                    setLogWallet(e.target.value ? Number(e.target.value) : undefined)
                  }
                  aria-label="Фильтр по кошельку"
                >
                  <option value="">Все кошельки</option>
                  {allWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-ink-3 inline-flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  {logs.total}
                </span>
              </div>
            </PanelHeader>
            <PanelBody className="p-0">
              {logs.query.isLoading && (
                <div className="px-5 py-10 text-center text-[13px] text-ink-4">
                  Загружаем…
                </div>
              )}
              {!logs.query.isLoading && logs.items.length === 0 && (
                <div className="px-5 py-12 text-center">
                  <div className="mx-auto h-10 w-10 grid place-items-center bg-surface-2 rounded-md mb-3">
                    <History className="h-4 w-4 text-ink-3" />
                  </div>
                  <p className="text-[13px] text-ink-3">
                    Здесь появятся все движения по кошелькам.
                  </p>
                </div>
              )}
              <ul className="divide-y divide-[var(--color-hairline)] max-h-none sm:max-h-[640px] sm:overflow-y-auto scrollbar-thin">
                {logs.items.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </ul>
              <LoadMore
                shown={logs.items.length}
                total={logs.total}
                hasMore={logs.hasMore}
                onMore={logs.loadMore}
                onAll={logs.loadAll}
                loading={logs.isLoadingMore}
              />
            </PanelBody>
          </Panel>
        </div>

        {/* Transfers */}
        <Panel className="anim-fade">
          <PanelHeader>
            <PanelTitle eyebrow="Переводы">Между кошельками</PanelTitle>
            <span className="text-[12px] text-ink-3">
              {transfers.total}{" "}
              {plural(transfers.total, "перевод", "перевода", "переводов")}
            </span>
          </PanelHeader>
          {transfers.items.length === 0 && !transfers.query.isLoading ? (
            <PanelBody>
              <p className="text-[13px] text-ink-4 text-center py-6">
                Переводов пока не было. Например, «сняли наличные» — это
                перевод со счёта в кошелёк «Наличные».
              </p>
            </PanelBody>
          ) : (
            <>
              <ul className="divide-y divide-[var(--color-hairline)]">
                {transfers.items.map((t) => (
                  <TransferRow key={t.id} transfer={t} canDelete={canUpdateWallet} />
                ))}
              </ul>
              <LoadMore
                shown={transfers.items.length}
                total={transfers.total}
                hasMore={transfers.hasMore}
                onMore={transfers.loadMore}
                onAll={transfers.loadAll}
                loading={transfers.isLoadingMore}
              />
            </>
          )}
        </Panel>
      </main>
    </>
  );
}

/* ----- analytics pieces ----- */

function FlowTotals({ analytics }: { analytics: WalletAnalytics }) {
  const canView = analytics.can_view_balance;
  const t = analytics.totals;
  const net = numericAmount(t.net);
  const cells = [
    {
      label: "Приход",
      value: formatProtectedCurrency(t.income_total, canView),
      sub: `${t.income_count} ${plural(t.income_count, "запись", "записи", "записей")}`,
      tone: "text-success",
    },
    {
      label: "Расход",
      value: formatProtectedCurrency(t.spending_total, canView),
      sub: `${t.spending_count} ${plural(t.spending_count, "запись", "записи", "записей")}`,
      tone: "text-danger",
    },
    {
      label: "Итог",
      value: canView
        ? `${net > 0 ? "+" : ""}${formatCurrency(net)}`
        : MASKED_AMOUNT,
      sub: "приход − расход",
      tone: net >= 0 ? "text-success" : "text-danger",
    },
    {
      label: "Переводы",
      value: formatProtectedCurrency(t.transfer_total, canView),
      sub: "между кошельками",
      tone: "text-ink",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="bg-surface border border-hairline rounded-md px-3 py-2.5">
          <div className="text-[11px] text-ink-3">{c.label}</div>
          <div className={cn("font-display text-[18px] tabular-nums mt-0.5 break-words", c.tone)}>
            {c.value}
          </div>
          <div className="text-[11px] text-ink-4 mt-0.5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function WalletFlowCard({
  row,
  color,
  canView,
}: {
  row: WalletAnalyticsRow;
  color: string;
  canView: boolean;
}) {
  const net = numericAmount(row.net);
  const transferIn = numericAmount(row.transfer_in);
  const transferOut = numericAmount(row.transfer_out);
  const topSpending = row.spending_by_type.slice(0, 4);
  const maxType = Math.max(1, ...topSpending.map((t) => numericAmount(t.total_amount)));

  return (
    <div className="border border-hairline rounded-lg p-4 flex flex-col gap-3 bg-canvas">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
          <span className="text-[14px] font-medium text-ink truncate">{row.name}</span>
          {row.is_default && <Star className="h-3 w-3 shrink-0 fill-current text-accent" />}
        </div>
        <span className="text-[11px] font-mono text-ink-4 truncate">{row.code}</span>
      </div>

      <div>
        <div className="text-[11px] text-ink-3">Остаток</div>
        <div className="font-display text-[22px] tabular-nums text-ink leading-tight break-words">
          {formatProtectedCurrency(row.balance, canView)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <div className="flex flex-col">
          <span className="text-ink-4 inline-flex items-center gap-1">
            <ArrowUpRight className="h-3 w-3 text-success" /> Приход
          </span>
          <span className="tabular-nums text-ink font-medium">
            {formatProtectedCurrency(row.income_total, canView)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-ink-4 inline-flex items-center gap-1">
            <ArrowDownRight className="h-3 w-3 text-danger" /> Расход
          </span>
          <span className="tabular-nums text-ink font-medium">
            {formatProtectedCurrency(row.spending_total, canView)}
          </span>
        </div>
      </div>

      {canView && (transferIn > 0 || transferOut > 0) && (
        <div className="text-[12px] text-ink-3 inline-flex items-center gap-1.5">
          <ArrowLeftRight className="h-3 w-3" />
          Переводы: +{formatCurrency(transferIn)} / −{formatCurrency(transferOut)}
        </div>
      )}

      {canView && (
        <div
          className={cn(
            "text-[12px] tabular-nums",
            net > 0 ? "text-success" : net < 0 ? "text-danger" : "text-ink-3"
          )}
        >
          Итог за период: {net > 0 ? "+" : ""}
          {formatCurrency(net)}
        </div>
      )}

      {canView && topSpending.length > 0 && (
        <div className="pt-2 border-t border-hairline space-y-1.5">
          <div className="text-[11px] text-ink-4">На что тратили</div>
          {topSpending.map((t) => {
            const meta = typeMetaForSpending(t.type);
            const pct = (numericAmount(t.total_amount) / maxType) * 100;
            return (
              <div key={t.type} className="text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink-2">
                    <span aria-hidden className="mr-1">{meta.icon}</span>
                    {meta.label}
                  </span>
                  <span className="tabular-nums text-ink shrink-0">
                    {formatCurrency(t.total_amount)}
                  </span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FlowChart({
  analytics,
  colorById,
}: {
  analytics: WalletAnalytics;
  colorById: Map<number, string>;
}) {
  const c = useChartColors();
  const [kind, setKind] = useState<"spending" | "income">("spending");
  const series = analytics.wallets.filter((w) =>
    kind === "spending" ? w.spending_count > 0 : w.income_count > 0
  );

  const data = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(
      "ru-RU",
      analytics.group_by === "month"
        ? { month: "short", year: "2-digit" }
        : { day: "numeric", month: "short" }
    );
    return analytics.timeline.map((b) => {
      const point: Record<string, string | number> = {
        d: fmt.format(new Date(`${b.date}T00:00:00`)),
      };
      for (const w of analytics.wallets) {
        point[`w${w.id}`] = numericAmount(b[kind][String(w.id)]);
      }
      return point;
    });
  }, [analytics, kind]);

  if (analytics.timeline.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-[13px] font-medium text-ink-2">
          {kind === "spending" ? "Расходы" : "Доходы"} по дням и кошелькам
        </h3>
        <div className="inline-flex rounded-md border border-hairline-strong overflow-hidden">
          {(["spending", "income"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                "h-7 px-2.5 text-[12px] transition-colors",
                kind === k ? "bg-surface-2 text-ink" : "text-ink-3 hover:text-ink"
              )}
            >
              {k === "spending" ? "Расходы" : "Доходы"}
            </button>
          ))}
        </div>
      </div>
      {series.length === 0 ? (
        <p className="text-[13px] text-ink-4 text-center py-10">
          За период нет {kind === "spending" ? "расходов" : "доходов"}.
        </p>
      ) : (
        <>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={c.hairline} vertical={false} />
                <XAxis
                  dataKey="d"
                  stroke={c.ink4}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={12}
                />
                <YAxis
                  stroke={c.ink4}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(v) =>
                    v >= 1_000_000
                      ? `${(v / 1_000_000).toFixed(1)}M`
                      : `${Math.round(v / 1000)}k`
                  }
                />
                <Tooltip
                  cursor={{ fill: c.surface3, opacity: 0.5 }}
                  contentStyle={{
                    background: c.canvas,
                    border: `1px solid ${c.hairlineStrong}`,
                    borderRadius: 8,
                    fontSize: 12,
                    color: c.ink,
                  }}
                  formatter={(v, name) => {
                    const id = Number(String(name).slice(1));
                    const wallet = analytics.wallets.find((w) => w.id === id);
                    return [formatCurrency(Number(v)), wallet?.name ?? String(name)];
                  }}
                />
                {series.map((w) => (
                  <Bar
                    key={w.id}
                    dataKey={`w${w.id}`}
                    stackId="wallets"
                    fill={colorById.get(w.id)}
                    maxBarSize={28}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-2">
            {series.map((w) => (
              <span key={w.id} className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
                <span className="h-2 w-2 rounded-full" style={{ background: colorById.get(w.id) }} />
                {w.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ----- pieces ----- */

function CurrentWalletCard({ wallet }: { wallet: Wallet | undefined }) {
  if (!wallet) {
    return (
      <div className="bg-canvas border border-hairline rounded-lg p-5 flex flex-col gap-3">
        <span className="text-[12px] text-ink-3 font-medium">
          Основной кошелёк
        </span>
        <span className="text-[13px] text-ink-4">Загружаем…</span>
      </div>
    );
  }
  return (
    <div className="bg-accent-soft border border-accent/20 rounded-lg p-5 flex flex-col gap-3 relative overflow-hidden">
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-accent/10 pointer-events-none" />
      <div className="flex items-center justify-between relative">
        <span className="text-[12px] text-accent-ink font-medium inline-flex items-center gap-1.5">
          <Star className="h-3 w-3 fill-current" />
          Основной кошелёк
        </span>
        <Badge tone="blue">{wallet.name}</Badge>
      </div>
      <div className="font-display text-[26px] sm:text-[34px] leading-[1.05] tracking-tight tabular-nums text-accent-ink relative break-words">
        {formatProtectedCurrency(wallet.balance, wallet.can_view_balance)}
      </div>
      <div className="text-[12px] text-accent-ink/80 relative">
        Обновлён {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(wallet.updated_at))}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  caption,
  icon,
  captionPositive,
  captionNegative,
}: {
  label: string;
  value: string;
  caption?: string;
  icon?: React.ReactNode;
  captionPositive?: boolean;
  captionNegative?: boolean;
}) {
  return (
    <div className="bg-canvas border border-hairline rounded-lg p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink-3 font-medium">{label}</span>
        {icon && (
          <span className="text-ink-4">
            {icon}
          </span>
        )}
      </div>
      <div className="font-display text-[22px] sm:text-[28px] leading-[1.1] tracking-tight tabular-nums text-ink break-words">
        {value}
      </div>
      {caption && (
        <div
          className={cn(
            "text-[12px]",
            captionPositive
              ? "text-success"
              : captionNegative
              ? "text-danger"
              : "text-ink-3"
          )}
        >
          {caption}
        </div>
      )}
    </div>
  );
}

function WalletRow({
  wallet,
  color,
  canEdit,
  canDelete,
}: {
  wallet: Wallet;
  color?: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => wallets.remove(wallet.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["wallets-current"] });
      qc.invalidateQueries({ queryKey: ["wallets-logs"] });
      qc.invalidateQueries({ queryKey: ["wallets-analytics"] });
      toast.success("Кошелёк удалён.");
    },
    onError: (err) => toast.error(asApiError(err).message),
  });

  const hasActions = canEdit || canDelete;

  return (
    <TR>
      <TD>
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 grid place-items-center bg-surface-2 rounded-md text-ink-3 relative">
            <WalletIcon className="h-4 w-4" />
            {color && (
              <span
                className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-canvas"
                style={{ background: color }}
              />
            )}
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-ink font-medium">{wallet.name}</span>
            <span className="text-[11px] text-ink-4 font-mono truncate">
              {wallet.code ? `код: ${wallet.code}` : `ID ${String(wallet.id).padStart(4, "0")}`}
            </span>
          </div>
        </div>
      </TD>
      <TD className="hidden sm:table-cell">
        <div className="flex items-center gap-1.5">
          {wallet.is_default && (
            <Badge tone="blue">
              <Star className="h-2.5 w-2.5 fill-current" />
              основной
            </Badge>
          )}
          {wallet.is_active ? (
            <Badge tone="green" dot>
              активен
            </Badge>
          ) : (
            <Badge tone="gray" dot>
              отключён
            </Badge>
          )}
        </div>
      </TD>
      <TD className="text-right font-medium tabular-nums whitespace-nowrap">
        {formatProtectedCurrency(wallet.balance, wallet.can_view_balance)}
      </TD>
      <TD>
        {hasActions && (
          <div className="flex items-center justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            {canEdit && (
              <WalletFormDialog
                initial={wallet}
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
            {canDelete && !wallet.is_default && (
              <button
                title="Удалить"
                onClick={() => {
                  if (confirm(`Удалить «${wallet.name}»?`)) del.mutate();
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

function TransferRow({
  transfer,
  canDelete,
}: {
  transfer: WalletTransfer;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => wallets.transfers.remove(transfer.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["wallets-current"] });
      qc.invalidateQueries({ queryKey: ["wallets-logs"] });
      qc.invalidateQueries({ queryKey: ["wallets-analytics"] });
      qc.invalidateQueries({ queryKey: ["wallets-transfers"] });
      toast.success("Перевод отменён.");
    },
    onError: (err) => toast.error(asApiError(err).message),
  });
  const actorName = transfer.actor_detail ? userDisplayName(transfer.actor_detail) : "Система";

  return (
    <li className="group px-5 py-3 flex items-center gap-3 hover:bg-surface transition-colors min-w-0">
      <div className="h-8 w-8 grid place-items-center rounded-md shrink-0 bg-tag-purple-bg text-tag-purple-fg">
        <ArrowLeftRight className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="flex items-center gap-1.5 text-[13px] text-ink flex-wrap">
          <span className="font-medium">{transfer.from_wallet_name}</span>
          <ArrowRight className="h-3.5 w-3.5 text-ink-4" />
          <span className="font-medium">{transfer.to_wallet_name}</span>
        </div>
        <div className="mt-1 text-[11px] text-ink-4 truncate">
          {formatDate(transfer.date)} · {actorName}
          {transfer.note ? ` · ${transfer.note}` : ""}
        </div>
      </div>
      <div className="text-right tabular-nums font-medium text-[13px] whitespace-nowrap shrink-0">
        {formatProtectedCurrency(transfer.amount, transfer.can_view_balance)}
      </div>
      {canDelete && (
        <button
          title="Отменить перевод"
          onClick={() => {
            if (confirm("Отменить перевод? Деньги вернутся обратно.")) del.mutate();
          }}
          disabled={del.isPending}
          className="h-7 w-7 grid place-items-center rounded text-ink-3 hover:text-danger hover:bg-tag-red-bg/30 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function LogRow({ log }: { log: WalletLog }) {
  const meta = walletActionMeta(log.action);
  const canViewBalance = log.can_view_balance;
  const delta = canViewBalance ? numericAmount(log.amount_delta) : 0;
  const isPositive = Number.isFinite(delta) && delta > 0;
  const isNegative = Number.isFinite(delta) && delta < 0;
  const actorName = log.actor_detail
    ? userDisplayName(log.actor_detail)
    : log.actor != null
    ? `Пользователь #${log.actor}`
    : "Система";

  return (
    <li className="px-5 py-3 flex items-start gap-3 hover:bg-surface transition-colors min-w-0">
      <div
        className={cn(
          "h-8 w-8 grid place-items-center rounded-md shrink-0",
          isPositive
            ? "bg-tag-green-bg text-tag-green-fg"
            : isNegative
            ? "bg-tag-red-bg text-tag-red-fg"
            : "bg-surface-2 text-ink-3"
        )}
      >
        {isPositive ? (
          <ArrowUpRight className="h-4 w-4" />
        ) : isNegative ? (
          <ArrowDownRight className="h-4 w-4" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {log.wallet_name && (
            <span className="text-[12px] text-ink-3">· {log.wallet_name}</span>
          )}
        </div>
        {log.description && (
          <p className="mt-1 text-[12px] text-ink-3 truncate">
            {log.description}
          </p>
        )}
        <div className="mt-1 text-[11px] text-ink-4 flex items-center gap-1.5">
          <Avatar name={actorName} size={16} className="text-[8px]" />
          <span>{actorName}</span>
          <span>·</span>
          <span>
            {new Intl.DateTimeFormat("ru-RU", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(log.created_at))}
          </span>
        </div>
      </div>
      <div
        className={cn(
          "text-right tabular-nums font-medium text-[13px] sm:whitespace-nowrap shrink-0",
          isPositive ? "text-success" : isNegative ? "text-danger" : "text-ink-3"
        )}
      >
        {canViewBalance && isPositive ? "+" : ""}
        {formatProtectedCurrency(delta, canViewBalance)}
        <div className="text-[10px] text-ink-4 font-normal">
          → {formatProtectedCurrency(log.balance_after, canViewBalance)}
        </div>
      </div>
    </li>
  );
}
