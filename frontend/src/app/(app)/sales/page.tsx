"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Flame,
  Handshake,
  MessageSquareText,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  TrendingUp,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { PermissionDenied } from "@/components/permission-gate";
import { Topbar } from "@/components/app-shell/topbar";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader, PanelTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { asApiError } from "@/lib/api";
import { sales } from "@/lib/endpoints";
import {
  useHasPermission,
  useIsSuperuser,
  useRole,
} from "@/lib/permissions";
import type {
  SalesEvent,
  SalesEventParticipant,
  SalesHotLead,
  SalesLead,
} from "@/lib/types";
import { cn, formatCurrency, formatDate, plural } from "@/lib/utils";
import { EventParticipantDialog } from "./event-participant-dialog";
import { HotLeadDialog } from "./hot-lead-dialog";
import { SalesEventDialog } from "./sales-event-dialog";
import { SalesLeadDialog } from "./sales-lead-dialog";

type SalesMode = "companies" | "hotleads" | "events";

export default function SalesPage() {
  const role = useRole();
  const isSuperuser = useIsSuperuser();
  const viewPermission = useHasPermission("sales_can_retrieve");
  const createPermission = useHasPermission("sales_can_create");
  const updatePermission = useHasPermission("sales_can_update");
  const deletePermission = useHasPermission("sales_can_delete");
  const allowed =
    isSuperuser || (role === "employee" && viewPermission.granted);
  const canCreate = isSuperuser || createPermission.granted;
  const canUpdate = isSuperuser || updatePermission.granted;
  const canDelete = isSuperuser || deletePermission.granted;
  const [mode, setMode] = useState<SalesMode>("companies");
  const [search, setSearch] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const leadsQuery = useQuery({
    queryKey: ["sales-leads"],
    queryFn: sales.list,
    enabled: allowed,
  });
  const hotLeadsQuery = useQuery({
    queryKey: ["sales-hot-leads"],
    queryFn: sales.hotLeads.list,
    enabled: allowed,
  });
  const eventsQuery = useQuery({
    queryKey: ["sales-events"],
    queryFn: sales.events.list,
    enabled: allowed,
  });

  const leads = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data]);
  const hotLeads = useMemo(
    () => hotLeadsQuery.data ?? [],
    [hotLeadsQuery.data]
  );
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const filteredLeads = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ru");
    if (!term) return leads;
    return leads.filter((lead) =>
      [lead.lead_name, lead.company, lead.comments].some((value) =>
        value.toLocaleLowerCase("ru").includes(term)
      )
    );
  }, [leads, search]);
  const filteredHotLeads = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ru");
    if (!term) return hotLeads;
    return hotLeads.filter((lead) =>
      [lead.name, lead.contact, lead.note].some((value) =>
        value.toLocaleLowerCase("ru").includes(term)
      )
    );
  }, [hotLeads, search]);
  const filteredEvents = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ru");
    if (!term) return events;
    return events.filter(
      (event) =>
        [event.name, event.comments].some((value) =>
          value.toLocaleLowerCase("ru").includes(term)
        ) ||
        event.participants.some((participant) =>
          [
            participant.lead_name,
            participant.company,
            participant.comments,
          ].some((value) => value.toLocaleLowerCase("ru").includes(term))
        )
    );
  }, [events, search]);

  const totalAmount = leads.reduce((sum, lead) => sum + Number(lead.amount), 0);
  const averageAmount = leads.length ? totalAmount / leads.length : 0;
  const companiesCount = new Set(
    leads.map((lead) => lead.company.trim().toLocaleLowerCase("ru"))
  ).size;

  const hotLeadsWithContact = hotLeads.filter(
    (lead) => lead.contact.trim().length > 0
  ).length;
  const hotLeadsWithNote = hotLeads.filter(
    (lead) => lead.note.trim().length > 0
  ).length;

  const eventParticipants = events.reduce(
    (sum, event) => sum + event.participant_count,
    0
  );
  const eventCapacity = events.reduce((sum, event) => sum + event.capacity, 0);
  const eventAmount = events.reduce(
    (sum, event) => sum + Number(event.total_amount),
    0
  );

  const selectedEvent = useMemo(() => {
    if (!filteredEvents.length) return null;
    return (
      filteredEvents.find((event) => event.id === selectedEventId) ??
      filteredEvents[0]
    );
  }, [filteredEvents, selectedEventId]);

  if (!isSuperuser && role === "employee" && viewPermission.isLoading) {
    return <Topbar eyebrow="Коммерция" title="Загрузка доступа…" />;
  }

  if (!allowed) {
    return (
      <>
        <Topbar eyebrow="Коммерция" title="Отдел продаж" />
        <PermissionDenied
          title="Доступ к продажам ограничен"
          detail="У вашей учётной записи нет права «sales_can_retrieve». Попросите администратора выдать доступ к просмотру продаж."
        />
      </>
    );
  }

  return (
    <>
      <Topbar
        eyebrow="Коммерция"
        title="Отдел продаж"
        actions={
          canCreate ? (
            mode === "companies" ? (
              <SalesLeadDialog
                trigger={
                  <Button variant="primary" size="sm">
                    <Plus className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Добавить компанию</span>
                    <span className="sm:hidden">Компания</span>
                  </Button>
                }
              />
            ) : mode === "hotleads" ? (
              <HotLeadDialog
                trigger={
                  <Button variant="primary" size="sm">
                    <Plus className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Добавить заявку</span>
                    <span className="sm:hidden">Заявка</span>
                  </Button>
                }
              />
            ) : (
              <SalesEventDialog
                trigger={
                  <Button variant="primary" size="sm">
                    <Plus className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Создать событие</span>
                    <span className="sm:hidden">Событие</span>
                  </Button>
                }
              />
            )
          ) : undefined
        }
      />

      <main className="flex-1 bg-surface px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-tag-blue-fg">
              <span className="h-1.5 w-1.5 rounded-full bg-tag-blue-fg" />
              Три формата продаж
            </div>
            <h2 className="font-display text-[24px] text-ink sm:text-[28px]">
              {mode === "companies"
                ? "Продажи компаниям"
                : mode === "hotleads"
                ? "Горячие заявки"
                : "Групповые события"}
            </h2>
            <p className="mt-1 max-w-2xl text-[13px] text-ink-3">
              {mode === "companies"
                ? "Компания оплачивает всю сумму сделки — один контакт, одна организация, один бюджет."
                : mode === "hotleads"
                ? "Быстрый захват входящего интереса: имя или название, контакт и короткая заметка."
                : "Создавайте событие на дату, задавайте размер группы и записывайте каждого участника отдельно."}
            </p>
          </div>

          <div className="relative w-full sm:w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                mode === "companies"
                  ? "Поиск по контакту или компании"
                  : mode === "hotleads"
                  ? "Поиск по имени, контакту или заметке"
                  : "Поиск по событию или участнику"
              }
              className="pl-9"
            />
          </div>
        </div>

        <div
          className="mb-5 grid max-w-[720px] grid-cols-3 rounded-lg border border-hairline-strong bg-canvas p-1 shadow-card"
          role="tablist"
          aria-label="Формат продаж"
        >
          <ModeTab
            active={mode === "companies"}
            icon={Building2}
            label="Продажи компаниям"
            count={leads.length}
            onClick={() => {
              setMode("companies");
              setSearch("");
            }}
          />
          <ModeTab
            active={mode === "hotleads"}
            icon={Flame}
            label="Горячие заявки"
            count={hotLeads.length}
            onClick={() => {
              setMode("hotleads");
              setSearch("");
            }}
          />
          <ModeTab
            active={mode === "events"}
            icon={CalendarDays}
            label="События"
            count={events.length}
            onClick={() => {
              setMode("events");
              setSearch("");
            }}
          />
        </div>

        {mode === "companies" ? (
          <>
            <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SalesStat
                icon={Handshake}
                label="Сделок в работе"
                value={String(leads.length)}
                detail={plural(leads.length, "контакт", "контакта", "контактов")}
                accent
              />
              <SalesStat
                icon={TrendingUp}
                label="Потенциальная сумма"
                value={formatCurrency(totalAmount)}
                detail={`Средняя — ${formatCurrency(averageAmount)}`}
              />
              <SalesStat
                icon={Building2}
                label="Компаний"
                value={String(companiesCount)}
                detail="уникальных организаций"
              />
            </section>

            {leadsQuery.isError && (
              <LoadError
                title="Не удалось загрузить корпоративные продажи"
                error={leadsQuery.error}
              />
            )}

            <CompanySalesTable
              leads={filteredLeads}
              loading={leadsQuery.isLoading}
              search={search}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
          </>
        ) : mode === "hotleads" ? (
          <>
            <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SalesStat
                icon={Flame}
                label="Горячих заявок"
                value={String(hotLeads.length)}
                detail={plural(
                  hotLeads.length,
                  "активная заявка",
                  "активные заявки",
                  "активных заявок"
                )}
                accent
              />
              <SalesStat
                icon={Phone}
                label="С контактом"
                value={String(hotLeadsWithContact)}
                detail="телефон или почта указаны"
              />
              <SalesStat
                icon={MessageSquareText}
                label="С заметкой"
                value={String(hotLeadsWithNote)}
                detail="есть контекст по заявке"
              />
            </section>

            {hotLeadsQuery.isError && (
              <LoadError
                title="Не удалось загрузить горячие заявки"
                error={hotLeadsQuery.error}
              />
            )}

            <HotLeadsTable
              leads={filteredHotLeads}
              loading={hotLeadsQuery.isLoading}
              search={search}
              canCreate={canCreate}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
          </>
        ) : (
          <>
            <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SalesStat
                icon={CalendarDays}
                label="Событий"
                value={String(events.length)}
                detail={plural(events.length, "дата", "даты", "дат")}
                accent
              />
              <SalesStat
                icon={UsersRound}
                label="Участников"
                value={`${eventParticipants} / ${eventCapacity}`}
                detail={`${Math.max(
                  0,
                  eventCapacity - eventParticipants
                )} свободно`}
              />
              <SalesStat
                icon={TrendingUp}
                label="Сумма записей"
                value={formatCurrency(eventAmount)}
                detail="по всем участникам"
              />
            </section>

            {eventsQuery.isError && (
              <LoadError
                title="Не удалось загрузить события"
                error={eventsQuery.error}
              />
            )}

            <EventsWorkspace
              events={filteredEvents}
              selectedEvent={selectedEvent}
              loading={eventsQuery.isLoading}
              search={search}
              canCreate={canCreate}
              canUpdate={canUpdate}
              canDelete={canDelete}
              onSelect={setSelectedEventId}
            />
          </>
        )}
      </main>
    </>
  );
}

function ModeTab({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-center justify-center gap-2 rounded-md px-2 py-2 text-[13px] font-medium transition-all sm:px-3",
        active
          ? "bg-surface-2 text-ink shadow-[0_1px_2px_rgba(15,15,15,0.06)]"
          : "text-ink-3 hover:bg-surface hover:text-ink"
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          active && "text-tag-blue-fg"
        )}
      />
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] tabular-nums",
          active ? "bg-canvas text-ink-2" : "bg-surface-2 text-ink-4"
        )}
      >
        {count}
      </span>
    </button>
  );
}

function CompanySalesTable({
  leads,
  loading,
  search,
  canUpdate,
  canDelete,
}: {
  leads: SalesLead[];
  loading: boolean;
  search: string;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Корпоративные сделки</PanelTitle>
        <span className="text-[12px] text-ink-3">
          {loading
            ? "Загрузка…"
            : `${leads.length} ${plural(
                leads.length,
                "запись",
                "записи",
                "записей"
              )}`}
        </span>
      </PanelHeader>

      <Table>
        <THead>
          <TR>
            <TH>Контакт</TH>
            <TH>Компания</TH>
            <TH className="text-right">Полная сумма</TH>
            <TH>Комментарии</TH>
            <TH className="w-20" />
          </TR>
        </THead>
        <tbody>
          {leads.map((lead) => (
            <SalesLeadRow
              key={lead.id}
              lead={lead}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
          ))}
          {!loading && leads.length === 0 && (
            <TR>
              <TD colSpan={5} className="py-14 text-center">
                <EmptyState
                  icon={Handshake}
                  title={search ? "Сделки не найдены" : "Пока нет сделок"}
                  detail={
                    search
                      ? "Попробуйте изменить поисковый запрос."
                      : "Добавьте первую корпоративную продажу."
                  }
                />
              </TD>
            </TR>
          )}
        </tbody>
      </Table>
    </Panel>
  );
}

function HotLeadsTable({
  leads,
  loading,
  search,
  canCreate,
  canUpdate,
  canDelete,
}: {
  leads: SalesHotLead[];
  loading: boolean;
  search: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Горячие заявки</PanelTitle>
        <span className="text-[12px] text-ink-3">
          {loading
            ? "Загрузка…"
            : `${leads.length} ${plural(
                leads.length,
                "заявка",
                "заявки",
                "заявок"
              )}`}
        </span>
      </PanelHeader>

      <Table>
        <THead>
          <TR>
            <TH>Заявка</TH>
            <TH>Контакт</TH>
            <TH>Заметка</TH>
            <TH className="w-20" />
          </TR>
        </THead>
        <tbody>
          {leads.map((lead) => (
            <HotLeadRow
              key={lead.id}
              lead={lead}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
          ))}
          {!loading && leads.length === 0 && (
            <TR>
              <TD colSpan={4} className="py-14 text-center">
                <EmptyState
                  icon={Flame}
                  title={search ? "Заявки не найдены" : "Пока нет заявок"}
                  detail={
                    search
                      ? "Попробуйте изменить поисковый запрос."
                      : "Добавьте первую горячую заявку."
                  }
                >
                  {!search && canCreate && (
                    <HotLeadDialog
                      trigger={
                        <Button variant="secondary" size="sm" className="mt-4">
                          <Plus className="h-3.5 w-3.5" />
                          Добавить заявку
                        </Button>
                      }
                    />
                  )}
                </EmptyState>
              </TD>
            </TR>
          )}
        </tbody>
      </Table>
    </Panel>
  );
}

function HotLeadRow({
  lead,
  canUpdate,
  canDelete,
}: {
  lead: SalesHotLead;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const removeMutation = useMutation({
    mutationFn: () => sales.hotLeads.remove(lead.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-hot-leads"] });
      toast.success("Горячая заявка удалена.");
    },
    onError: (error) => toast.error(asApiError(error).message),
  });

  return (
    <TR>
      <TD>
        <div className="min-w-[150px]">
          <div className="font-medium text-ink">{lead.name}</div>
          <div className="mt-0.5 text-[11px] text-ink-4">
            Добавлена {formatDate(lead.created_at)}
          </div>
        </div>
      </TD>
      <TD>
        <div className="flex min-w-[160px] items-center gap-2 text-ink-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-surface-2 text-ink-3">
            <Phone className="h-3.5 w-3.5" />
          </span>
          <span className="break-all">{lead.contact}</span>
        </div>
      </TD>
      <TD>
        <div
          className={cn(
            "flex min-w-[220px] max-w-[420px] items-center gap-2 text-[13px]",
            lead.note ? "text-ink-3" : "text-ink-4"
          )}
          title={lead.note || undefined}
        >
          <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{lead.note || "Без заметки"}</span>
        </div>
      </TD>
      <TD>
        {(canUpdate || canDelete) && (
          <div className="flex items-center justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            {canUpdate && (
              <HotLeadDialog
                initial={lead}
                trigger={
                  <button
                    title="Редактировать"
                    className="grid h-7 w-7 place-items-center rounded text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                }
              />
            )}
            {canDelete && (
              <button
                title="Удалить"
                disabled={removeMutation.isPending}
                onClick={() => {
                  if (confirm(`Удалить заявку «${lead.name}»?`)) {
                    removeMutation.mutate();
                  }
                }}
                className="grid h-7 w-7 place-items-center rounded text-ink-3 transition-colors hover:bg-tag-red-bg/30 hover:text-danger disabled:opacity-40"
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

function EventsWorkspace({
  events,
  selectedEvent,
  loading,
  search,
  canCreate,
  canUpdate,
  canDelete,
  onSelect,
}: {
  events: SalesEvent[];
  selectedEvent: SalesEvent | null;
  loading: boolean;
  search: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onSelect: (id: number) => void;
}) {
  if (!loading && events.length === 0) {
    return (
      <Panel className="grid min-h-[280px] place-items-center p-8 text-center">
        <div className="flex max-w-sm flex-col items-center">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-tag-orange-bg text-tag-orange-fg">
            <CalendarDays className="h-5 w-5" />
          </span>
          <h3 className="font-display text-[18px] text-ink">
            {search ? "События не найдены" : "Создайте первое событие"}
          </h3>
          <p className="mt-2 text-[13px] text-ink-3">
            {search
              ? "Попробуйте изменить поисковый запрос."
              : "Укажите дату и количество мест, затем добавляйте участников по одному."}
          </p>
          {!search && canCreate && (
            <SalesEventDialog
              trigger={
                <Button variant="primary" size="md" className="mt-5">
                  <Plus className="h-3.5 w-3.5" />
                  Создать событие
                </Button>
              }
            />
          )}
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader>
          <PanelTitle>События</PanelTitle>
          <span className="text-[12px] text-ink-3">
            {loading ? "Загрузка…" : events.length}
          </span>
        </PanelHeader>
        <div className="divide-y divide-hairline">
          {events.map((event) => {
            const active = selectedEvent?.id === event.id;
            const freePlaces = Math.max(
              0,
              event.capacity - event.participant_count
            );
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => onSelect(event.id)}
                className={cn(
                  "group/event flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                  active ? "bg-accent-soft" : "hover:bg-surface"
                )}
              >
                <EventDateBadge value={event.event_date} active={active} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink">
                      {event.name}
                    </span>
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform",
                        active && "translate-x-0.5 text-accent"
                      )}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                    <span
                      className={cn(
                        "font-medium",
                        freePlaces === 0 ? "text-success" : "text-ink-3"
                      )}
                    >
                      {event.participant_count}/{event.capacity} участников
                    </span>
                    <span className="tabular-nums text-ink-3">
                      {formatCurrency(event.total_amount)}
                    </span>
                  </div>
                  <CapacityBar
                    count={event.participant_count}
                    capacity={event.capacity}
                    className="mt-2"
                  />
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      {selectedEvent && (
        <EventDetail
          event={selectedEvent}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canDelete={canDelete}
        />
      )}
    </div>
  );
}

function EventDetail({
  event,
  canCreate,
  canUpdate,
  canDelete,
}: {
  event: SalesEvent;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const freePlaces = Math.max(0, event.capacity - event.participant_count);
  const removeMutation = useMutation({
    mutationFn: () => sales.events.remove(event.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-events"] });
      toast.success("Событие удалено.");
    },
    onError: (error) => toast.error(asApiError(error).message),
  });

  return (
    <Panel className="min-w-0 overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-hairline px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-ink">
              {event.name}
            </span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                freePlaces === 0
                  ? "bg-tag-green-bg text-tag-green-fg"
                  : "bg-tag-orange-bg text-tag-orange-fg"
              )}
            >
              {freePlaces === 0 ? "Группа собрана" : `${freePlaces} свободно`}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {formatEventDate(event.event_date)}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {canCreate && freePlaces > 0 && (
            <EventParticipantDialog
              eventId={event.id}
              eventName={event.name}
              trigger={
                <Button variant="primary" size="sm">
                  <UserPlus className="h-3.5 w-3.5" />
                  Добавить участника
                </Button>
              }
            />
          )}
          {canCreate && freePlaces === 0 && (
            <Button variant="secondary" size="sm" disabled>
              <UsersRound className="h-3.5 w-3.5" />
              Мест нет
            </Button>
          )}
          {canUpdate && (
            <SalesEventDialog
              initial={event}
              trigger={
                <Button variant="ghost" size="icon" title="Изменить событие">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              }
            />
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              title="Удалить событие"
              disabled={removeMutation.isPending}
              onClick={() => {
                if (
                  confirm(
                    `Удалить событие «${event.name}» и всех его участников?`
                  )
                ) {
                  removeMutation.mutate();
                }
              }}
              className="hover:bg-tag-red-bg/30 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 border-b border-hairline bg-surface/70 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-5">
        <div>
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <span className="font-medium text-ink-2">Заполнение группы</span>
            <span className="tabular-nums text-ink-3">
              {event.participant_count} из {event.capacity}
            </span>
          </div>
          <CapacityBar
            count={event.participant_count}
            capacity={event.capacity}
            className="mt-2.5"
          />
          {event.comments && (
            <p className="mt-3 flex items-start gap-2 text-[12px] text-ink-3">
              <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{event.comments}</span>
            </p>
          )}
        </div>
        <div className="rounded-lg border border-hairline bg-canvas px-4 py-2.5 sm:min-w-[150px] sm:text-right">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-4">
            Сумма группы
          </div>
          <div className="mt-0.5 font-display text-[18px] tabular-nums text-ink">
            {formatCurrency(event.total_amount)}
          </div>
        </div>
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Участник</TH>
            <TH>Компания / организация</TH>
            <TH className="text-right">Сумма</TH>
            <TH>Комментарий</TH>
            <TH className="w-20" />
          </TR>
        </THead>
        <tbody>
          {event.participants.map((participant) => (
            <EventParticipantRow
              key={participant.id}
              event={event}
              participant={participant}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
          ))}
          {event.participants.length === 0 && (
            <TR>
              <TD colSpan={5} className="py-12 text-center">
                <EmptyState
                  icon={CircleUserRound}
                  title="Участников пока нет"
                  detail="Добавьте первого человека в группу."
                >
                  {canCreate && (
                    <EventParticipantDialog
                      eventId={event.id}
                      eventName={event.name}
                      trigger={
                        <Button variant="secondary" size="sm" className="mt-4">
                          <UserPlus className="h-3.5 w-3.5" />
                          Добавить участника
                        </Button>
                      }
                    />
                  )}
                </EmptyState>
              </TD>
            </TR>
          )}
        </tbody>
      </Table>
    </Panel>
  );
}

function EventParticipantRow({
  event,
  participant,
  canUpdate,
  canDelete,
}: {
  event: SalesEvent;
  participant: SalesEventParticipant;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const removeMutation = useMutation({
    mutationFn: () => sales.eventParticipants.remove(participant.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-events"] });
      toast.success("Участник удалён из события.");
    },
    onError: (error) => toast.error(asApiError(error).message),
  });

  return (
    <TR>
      <TD>
        <div className="min-w-[150px]">
          <div className="font-medium text-ink">{participant.lead_name}</div>
          <div className="mt-0.5 text-[11px] text-ink-4">
            Добавлен {formatDate(participant.created_at)}
          </div>
        </div>
      </TD>
      <TD>
        <div
          className={cn(
            "flex min-w-[150px] items-center gap-2",
            participant.company ? "text-ink-2" : "text-ink-4"
          )}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-surface-2 text-ink-3">
            <Building2 className="h-3.5 w-3.5" />
          </span>
          <span>{participant.company || "Не указана"}</span>
        </div>
      </TD>
      <TD className="min-w-[130px] text-right font-medium tabular-nums">
        {formatCurrency(participant.amount)}
      </TD>
      <TD>
        <div
          className={cn(
            "flex min-w-[200px] max-w-[360px] items-center gap-2 text-[13px]",
            participant.comments ? "text-ink-3" : "text-ink-4"
          )}
          title={participant.comments || undefined}
        >
          <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {participant.comments || "Без комментария"}
          </span>
        </div>
      </TD>
      <TD>
        {(canUpdate || canDelete) && (
          <div className="flex items-center justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            {canUpdate && (
              <EventParticipantDialog
                eventId={event.id}
                eventName={event.name}
                initial={participant}
                trigger={
                  <button
                    title="Редактировать"
                    className="grid h-7 w-7 place-items-center rounded text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                }
              />
            )}
            {canDelete && (
              <button
                title="Удалить"
                disabled={removeMutation.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `Удалить участника «${participant.lead_name}» из события?`
                    )
                  ) {
                    removeMutation.mutate();
                  }
                }}
                className="grid h-7 w-7 place-items-center rounded text-ink-3 transition-colors hover:bg-tag-red-bg/30 hover:text-danger disabled:opacity-40"
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

function SalesLeadRow({
  lead,
  canUpdate,
  canDelete,
}: {
  lead: SalesLead;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const removeMutation = useMutation({
    mutationFn: () => sales.remove(lead.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-leads"] });
      toast.success("Корпоративная сделка удалена.");
    },
    onError: (error) => toast.error(asApiError(error).message),
  });

  return (
    <TR>
      <TD>
        <div className="min-w-[150px]">
          <div className="font-medium text-ink">{lead.lead_name}</div>
          <div className="mt-0.5 text-[11px] text-ink-4">
            Добавлен {formatDate(lead.created_at)}
          </div>
        </div>
      </TD>
      <TD>
        <div className="flex min-w-[140px] items-center gap-2 text-ink-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-surface-2 text-ink-3">
            <Building2 className="h-3.5 w-3.5" />
          </span>
          <span>{lead.company}</span>
        </div>
      </TD>
      <TD className="min-w-[140px] text-right font-medium tabular-nums">
        {formatCurrency(lead.amount)}
      </TD>
      <TD>
        <div
          className={cn(
            "flex min-w-[220px] max-w-[420px] items-center gap-2 text-[13px]",
            lead.comments ? "text-ink-3" : "text-ink-4"
          )}
          title={lead.comments || undefined}
        >
          <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{lead.comments || "Без комментария"}</span>
        </div>
      </TD>
      <TD>
        {(canUpdate || canDelete) && (
          <div className="flex items-center justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            {canUpdate && (
              <SalesLeadDialog
                initial={lead}
                trigger={
                  <button
                    title="Редактировать"
                    className="grid h-7 w-7 place-items-center rounded text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                }
              />
            )}
            {canDelete && (
              <button
                title="Удалить"
                disabled={removeMutation.isPending}
                onClick={() => {
                  if (confirm(`Удалить сделку с «${lead.company}»?`)) {
                    removeMutation.mutate();
                  }
                }}
                className="grid h-7 w-7 place-items-center rounded text-ink-3 transition-colors hover:bg-tag-red-bg/30 hover:text-danger disabled:opacity-40"
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

function SalesStat({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-hairline bg-canvas p-4 shadow-card",
        accent && "border-accent/20 bg-accent-soft"
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-3",
          accent && "bg-canvas/70 text-accent-ink"
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-ink-3">{label}</div>
        <div
          className={cn(
            "mt-1 truncate font-display text-[22px] tabular-nums text-ink",
            accent && "text-accent-ink"
          )}
          title={value}
        >
          {value}
        </div>
        <div className="mt-1 text-[11px] text-ink-4">{detail}</div>
      </div>
    </div>
  );
}

function CapacityBar({
  count,
  capacity,
  className,
}: {
  count: number;
  capacity: number;
  className?: string;
}) {
  const percent = capacity > 0 ? Math.min(100, (count / capacity) * 100) : 0;
  return (
    <div
      className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", className)}
      title={`Заполнено ${Math.round(percent)}%`}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300",
          percent >= 100 ? "bg-success" : "bg-accent"
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function EventDateBadge({
  value,
  active,
}: {
  value: string;
  active: boolean;
}) {
  const date = new Date(`${value}T00:00:00`);
  const day = new Intl.DateTimeFormat("ru-RU", { day: "2-digit" }).format(date);
  const month = new Intl.DateTimeFormat("ru-RU", { month: "short" })
    .format(date)
    .replace(".", "");

  return (
    <span
      className={cn(
        "grid h-12 w-12 shrink-0 place-items-center rounded-lg border bg-canvas text-center shadow-card",
        active ? "border-accent/30" : "border-hairline"
      )}
    >
      <span className="flex flex-col leading-none">
        <span className="font-display text-[17px] tabular-nums text-ink">{day}</span>
        <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-tag-orange-fg">
          {month}
        </span>
      </span>
    </span>
  );
}

function EmptyState({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-xs flex-col items-center">
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-ink-4">
        <Icon className="h-4 w-4" />
      </span>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="mt-1 text-[12px] text-ink-3">{detail}</p>
      {children}
    </div>
  );
}

function LoadError({ title, error }: { title: string; error: unknown }) {
  return (
    <Panel className="mb-5 border-tag-red-bg bg-tag-red-bg/20 p-4">
      <p className="text-[14px] font-medium text-danger">{title}</p>
      <p className="mt-1 text-[12px] text-ink-3">
        {asApiError(error).message}
      </p>
    </Panel>
  );
}

function formatEventDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
