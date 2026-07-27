import { api } from "./api";
import type {
  Client,
  ClientCreate,
  ClientUpdate,
  DashboardAnalytics,
  DashboardFilters,
  DashboardMyTasksAnalytics,
  Deal,
  DealCreate,
  DealFile,
  DealFileCreate,
  DealLink,
  DealLinkCreate,
  DealPayment,
  DealPaymentCreate,
  DealStage,
  DealStageCreate,
  Employee,
  Income,
  IncomeAnalytics,
  IncomeCreate,
  IncomeFilters,
  JWTPair,
  MonthlyObligation,
  MonthlyObligationActionResult,
  MonthlyObligationAnalytics,
  MonthlyObligationCreate,
  Onboard,
  OnboardCreate,
  OnboardUpdate,
  OnboardTask,
  OnboardTaskCreate,
  PasswordResetConfirm,
  SalesHotLead,
  SalesHotLeadCreate,
  SalesLead,
  SalesLeadCreate,
  SalesEvent,
  SalesEventCreate,
  SalesEventParticipant,
  SalesEventParticipantCreate,
  Spending,
  SpendingAnalytics,
  SpendingCreate,
  SpendingFilters,
  TaskAttachment,
  TaskCategory,
  TaskCategoryCreate,
  User,
  UserCreate,
  UserUpdate,
  UserRole,
  Wallet,
  WalletCreate,
  WalletLog,
} from "./types";

/* ---------------- Auth ---------------- */

export const auth = {
  loginViaEmail: (email: string, password: string) =>
    api
      .post<JWTPair>("/users/login-via-email/", { email, password })
      .then((r) => r.data),
  loginViaUsername: (username: string, password: string) =>
    api
      .post<JWTPair>("/users/login-via-username/", { username, password })
      .then((r) => r.data),
  refresh: (refresh: string) =>
    api
      .post<{ access: string }>("/users/token/refresh/", { refresh })
      .then((r) => r.data),
  profile: () => api.get<User>("/users/profile/").then((r) => r.data),
  requestPasswordReset: (email: string) =>
    api
      .post<{ detail: string }>("/users/password-reset/request/", { email })
      .then((r) => r.data),
  confirmPasswordReset: (payload: PasswordResetConfirm) =>
    api
      .post<{ detail: string }>("/users/password-reset/confirm/", payload)
      .then((r) => r.data),
};

/* ---------------- Users (admin-side) ---------------- */

function unwrapList<T>(data: T[] | { results: T[] }): T[] {
  return Array.isArray(data) ? data : data.results;
}

export const users = {
  list: (role?: UserRole) =>
    api
      .get<User[] | { results: User[] }>("/users/", {
        params: role ? { role } : undefined,
      })
      .then((r) => unwrapList(r.data)),
  create: (payload: UserCreate) =>
    api.post<User>("/users/", payload).then((r) => r.data),
  update: (id: number, payload: UserUpdate) =>
    api.patch<User>(`/users/${id}/`, payload).then((r) => r.data),
};

/* ---------------- Clients (admin-side) ---------------- */

export const clients = {
  list: () =>
    api
      .get<Client[] | { results: Client[] }>("/clients/")
      .then((r) => unwrapList(r.data)),
  create: (payload: ClientCreate) =>
    api.post<Client>("/clients/", payload).then((r) => r.data),
  update: (id: number, payload: ClientUpdate) =>
    api.patch<Client>(`/clients/${id}/`, payload).then((r) => r.data),
  setPassword: (id: number, password: string) =>
    api
      .post<{ detail: string }>(`/clients/${id}/set-password/`, { password })
      .then((r) => r.data),
  deactivate: (id: number) => api.delete(`/clients/${id}/`).then(() => undefined),
  activate: (id: number) =>
    api.post<Client>(`/clients/${id}/activate/`).then((r) => r.data),
};

/* ---------------- Employees ---------------- */

export const employees = {
  list: () => api.get<Employee[]>("/employees/").then((r) => r.data),
  retrieve: (id: number) =>
    api.get<Employee>(`/employees/${id}/`).then((r) => r.data),
  create: (payload: Partial<Employee> & { user: number }) =>
    api.post<Employee>("/employees/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<Employee>) =>
    api.patch<Employee>(`/employees/${id}/`, payload).then((r) => r.data),
};

/* ---------------- Projects / legacy deals ---------------- */

// Alias so existing call sites keep working without churn.
const unwrap = unwrapList;

function projectFileFormData(payload: DealFileCreate): FormData | DealFileCreate {
  if (typeof payload.file === "string") return payload;

  const formData = new FormData();
  formData.append("file", payload.file);
  if (payload.file_name) formData.append("file_name", payload.file_name);
  if (payload.description) formData.append("description", payload.description);
  return formData;
}

export const projects = {
  list: () =>
    api
      .get<Deal[] | { results: Deal[] }>("/projects/")
      .then((r) => unwrap(r.data)),

  /**
   * Collaborator-scoped list. The shared `GET /api/projects/` endpoint already
   * filters to the requesting user on the backend (own projects + any project where
   * they appear in `collaborators`). We keep a defensive client-side filter so
   * an admin token doesn't accidentally show the full list under this key.
   */
  listForUser: (userId: number) =>
    api
      .get<Deal[] | { results: Deal[] }>("/projects/")
      .then((r) =>
        unwrap(r.data).filter((d) => {
          const primary =
            typeof d.user === "number"
              ? d.user
              : d.user && typeof d.user === "object"
              ? d.user.id
              : null;
          if (primary === userId) return true;
          if ((d.collaborators ?? []).includes(userId)) return true;
          if ((d.collaborator_details ?? []).some((u) => u.id === userId))
            return true;
          return false;
        })
      ),

  retrieve: (id: number) =>
    api.get<Deal>(`/projects/${id}/`).then((r) => r.data),

  create: (payload: DealCreate) =>
    api.post<Deal>("/projects/", payload).then((r) => r.data),

  update: (id: number, payload: Partial<DealCreate>) =>
    api.patch<Deal>(`/projects/${id}/`, payload).then((r) => r.data),

  remove: (id: number) =>
    api.delete<void>(`/projects/${id}/`).then((r) => r.data),

  /* Files & payments — only POST/DELETE exposed on backend, no GET list. */
  addFile: (dealId: number, payload: DealFileCreate) =>
    api
      .post<DealFile>(`/projects/${dealId}/files/`, projectFileFormData(payload), {
        headers:
          typeof payload.file === "string"
            ? undefined
            : { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data),
  removeFile: (dealId: number, fileId: number) =>
    api
      .delete<void>(`/projects/${dealId}/files/${fileId}/`)
      .then((r) => r.data),

  addStage: (dealId: number, payload: DealStageCreate) =>
    api
      .post<DealStage>(`/projects/${dealId}/stages/`, payload)
      .then((r) => r.data),
  updateStage: (dealId: number, stageId: number, payload: Partial<DealStageCreate>) =>
    api
      .patch<DealStage>(`/projects/${dealId}/stages/${stageId}/`, payload)
      .then((r) => r.data),
  removeStage: (dealId: number, stageId: number) =>
    api
      .delete<void>(`/projects/${dealId}/stages/${stageId}/`)
      .then((r) => r.data),

  addLink: (dealId: number, payload: DealLinkCreate) =>
    api
      .post<DealLink>(`/projects/${dealId}/links/`, payload)
      .then((r) => r.data),
  updateLink: (dealId: number, linkId: number, payload: Partial<DealLinkCreate>) =>
    api
      .patch<DealLink>(`/projects/${dealId}/links/${linkId}/`, payload)
      .then((r) => r.data),
  removeLink: (dealId: number, linkId: number) =>
    api
      .delete<void>(`/projects/${dealId}/links/${linkId}/`)
      .then((r) => r.data),

  addPayment: (dealId: number, payload: DealPaymentCreate) =>
    api
      .post<DealPayment>(`/projects/${dealId}/payments/`, payload)
      .then((r) => r.data),
  removePayment: (dealId: number, paymentId: number) =>
    api
      .delete<void>(`/projects/${dealId}/payments/${paymentId}/`)
      .then((r) => r.data),
};

export const deals = projects;

/* ---------------- Onboards ---------------- */

export const onboards = {
  list: () =>
    api
      .get<Onboard[] | { results: Onboard[] }>("/onboards/")
      .then((r) => unwrap(r.data)),

  retrieve: (id: number) =>
    api.get<Onboard>(`/onboards/${id}/`).then((r) => r.data),

  /** Onboards attached to a specific deal (one deal can have several). */
  forDeal: async (dealId: number): Promise<Onboard[]> => {
    const all = await onboards.list();
    return all.filter((o) => o.deal === dealId);
  },

  create: (payload: OnboardCreate) =>
    api.post<Onboard>("/onboards/", payload).then((r) => r.data),
  update: (id: number, payload: OnboardUpdate) =>
    api.patch<Onboard>(`/onboards/${id}/`, payload).then((r) => r.data),
  remove: (id: number) =>
    api.delete<void>(`/onboards/${id}/`).then((r) => r.data),

  /* Categories */
  categoriesList: () =>
    api
      .get<TaskCategory[] | { results: TaskCategory[] }>(
        "/onboards/categories/"
      )
      .then((r) => unwrap(r.data)),
  createCategory: (payload: TaskCategoryCreate) =>
    api
      .post<TaskCategory>("/onboards/categories/", payload)
      .then((r) => r.data),
  updateCategory: (id: number, payload: Partial<TaskCategoryCreate>) =>
    api
      .patch<TaskCategory>(`/onboards/categories/${id}/`, payload)
      .then((r) => r.data),
  removeCategory: (id: number) =>
    api
      .delete<void>(`/onboards/categories/${id}/`)
      .then((r) => r.data),

  /* Tasks */
  tasksList: () =>
    api
      .get<OnboardTask[] | { results: OnboardTask[] }>("/onboards/tasks/")
      .then((r) => unwrap(r.data)),
  createTask: (payload: OnboardTaskCreate) =>
    api.post<OnboardTask>("/onboards/tasks/", payload).then((r) => r.data),
  updateTask: (id: number, payload: Partial<OnboardTaskCreate>) =>
    api
      .patch<OnboardTask>(`/onboards/tasks/${id}/`, payload)
      .then((r) => r.data),
  removeTask: (id: number) =>
    api.delete<void>(`/onboards/tasks/${id}/`).then((r) => r.data),
  uploadTaskAttachment: (taskId: number, formData: FormData) =>
    api
      .post<TaskAttachment | TaskAttachment[]>(
        `/onboards/tasks/${taskId}/attachments/`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      )
      .then((r) => r.data),
  removeTaskAttachment: (taskId: number, attachmentId: number) =>
    api
      .delete<void>(`/onboards/tasks/${taskId}/attachments/${attachmentId}/`)
      .then((r) => r.data),

  /* TaskPerformance — assignees on a task */
  assign: (taskId: number, userId: number) =>
    api
      .post<OnboardTask>(`/onboards/tasks/${taskId}/assign/`, { user: userId })
      .then((r) => r.data),
  unassign: (taskId: number, userId: number) =>
    api
      .delete<void>(`/onboards/tasks/${taskId}/unassign/${userId}/`)
      .then((r) => r.data),
};

/* ---------------- Spendings ---------------- */

function spendingsParams(filters?: SpendingFilters) {
  const params: Record<string, string> = {};
  if (filters?.from_date) params.from_date = filters.from_date;
  if (filters?.to_date) params.to_date = filters.to_date;
  if (filters?.type) params.type = filters.type;
  return params;
}

export const spendings = {
  list: (filters?: SpendingFilters) =>
    api
      .get<Spending[] | { results: Spending[] }>("/spendings/", {
        params: spendingsParams(filters),
      })
      .then((r) => unwrap(r.data)),
  retrieve: (id: number) =>
    api.get<Spending>(`/spendings/${id}/`).then((r) => r.data),
  create: (payload: SpendingCreate) =>
    api.post<Spending>("/spendings/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<SpendingCreate>) =>
    api.patch<Spending>(`/spendings/${id}/`, payload).then((r) => r.data),
  remove: (id: number) =>
    api.delete<void>(`/spendings/${id}/`).then((r) => r.data),
  analytics: (filters?: SpendingFilters) =>
    api
      .get<SpendingAnalytics>("/spendings/analytics/", {
        params: spendingsParams(filters),
      })
      .then((r) => r.data),
};

export const monthlyObligations = {
  list: (params?: { active?: boolean; search?: string }) =>
    api
      .get<MonthlyObligation[] | { results: MonthlyObligation[] }>(
        "/spendings/monthly-obligations/",
        {
          params: {
            active: params?.active,
            search: params?.search || undefined,
          },
        }
      )
      .then((r) => unwrap(r.data)),
  create: (payload: MonthlyObligationCreate) =>
    api
      .post<MonthlyObligation>("/spendings/monthly-obligations/", payload)
      .then((r) => r.data),
  update: (id: number, payload: Partial<MonthlyObligationCreate>) =>
    api
      .patch<MonthlyObligation>(
        `/spendings/monthly-obligations/${id}/`,
        payload
      )
      .then((r) => r.data),
  remove: (id: number) =>
    api
      .delete<void>(`/spendings/monthly-obligations/${id}/`)
      .then((r) => r.data),
  excludeCurrentMonth: (id: number) =>
    api
      .post<MonthlyObligationActionResult>(
        `/spendings/monthly-obligations/${id}/exclude-current-month/`
      )
      .then((r) => r.data),
  clearCurrentMonthExclusion: (id: number) =>
    api
      .post<MonthlyObligationActionResult>(
        `/spendings/monthly-obligations/${id}/clear-current-month-exclusion/`
      )
      .then((r) => r.data),
  chargeDue: (payload?: { dry_run?: boolean; notify?: boolean }) =>
    api
      .post("/spendings/monthly-obligations/charge-due/", payload ?? {})
      .then((r) => r.data),
  analytics: () =>
    api
      .get<MonthlyObligationAnalytics>(
        "/spendings/monthly-obligations/analytics/"
      )
      .then((r) => r.data),
};

/* ---------------- Incomes ----------------
 *
 * Mirrors the Spending API. Until the backend implements `/api/incomes/`,
 * these calls will return 404 — frontend will surface that as a normal
 * "loading failed" state. Drop-in once the endpoint exists.
 */

function incomesParams(filters?: IncomeFilters) {
  const params: Record<string, string> = {};
  if (filters?.from_date) params.from_date = filters.from_date;
  if (filters?.to_date) params.to_date = filters.to_date;
  if (filters?.type) params.type = filters.type;
  return params;
}

export const incomes = {
  list: (filters?: IncomeFilters) =>
    api
      .get<Income[] | { results: Income[] }>("/incomes/", {
        params: incomesParams(filters),
      })
      .then((r) => unwrap(r.data)),
  retrieve: (id: number) =>
    api.get<Income>(`/incomes/${id}/`).then((r) => r.data),
  create: (payload: IncomeCreate) =>
    api.post<Income>("/incomes/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<IncomeCreate>) =>
    api.patch<Income>(`/incomes/${id}/`, payload).then((r) => r.data),
  remove: (id: number) =>
    api.delete<void>(`/incomes/${id}/`).then((r) => r.data),
  analytics: (filters?: IncomeFilters) =>
    api
      .get<IncomeAnalytics>("/incomes/analytics/", {
        params: incomesParams(filters),
      })
      .then((r) => r.data),
};

/* ---------------- Sales ---------------- */

export const sales = {
  list: () =>
    api
      .get<SalesLead[] | { results: SalesLead[] }>("/sales/")
      .then((r) => unwrap(r.data)),
  create: (payload: SalesLeadCreate) =>
    api.post<SalesLead>("/sales/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<SalesLeadCreate>) =>
    api.patch<SalesLead>(`/sales/${id}/`, payload).then((r) => r.data),
  remove: (id: number) =>
    api.delete<void>(`/sales/${id}/`).then((r) => r.data),
  hotLeads: {
    list: () =>
      api
        .get<SalesHotLead[] | { results: SalesHotLead[] }>("/sales/hot-leads/")
        .then((r) => unwrap(r.data)),
    create: (payload: SalesHotLeadCreate) =>
      api.post<SalesHotLead>("/sales/hot-leads/", payload).then((r) => r.data),
    update: (id: number, payload: Partial<SalesHotLeadCreate>) =>
      api
        .patch<SalesHotLead>(`/sales/hot-leads/${id}/`, payload)
        .then((r) => r.data),
    remove: (id: number) =>
      api.delete<void>(`/sales/hot-leads/${id}/`).then((r) => r.data),
  },
  events: {
    list: () =>
      api
        .get<SalesEvent[] | { results: SalesEvent[] }>("/sales/events/")
        .then((r) => unwrap(r.data)),
    create: (payload: SalesEventCreate) =>
      api.post<SalesEvent>("/sales/events/", payload).then((r) => r.data),
    update: (id: number, payload: Partial<SalesEventCreate>) =>
      api.patch<SalesEvent>(`/sales/events/${id}/`, payload).then((r) => r.data),
    remove: (id: number) =>
      api.delete<void>(`/sales/events/${id}/`).then((r) => r.data),
  },
  eventParticipants: {
    create: (payload: SalesEventParticipantCreate) =>
      api
        .post<SalesEventParticipant>("/sales/event-participants/", payload)
        .then((r) => r.data),
    update: (
      id: number,
      payload: Partial<SalesEventParticipantCreate>
    ) =>
      api
        .patch<SalesEventParticipant>(
          `/sales/event-participants/${id}/`,
          payload
        )
        .then((r) => r.data),
    remove: (id: number) =>
      api
        .delete<void>(`/sales/event-participants/${id}/`)
        .then((r) => r.data),
  },
};

/* ---------------- Dashboard ----------------
 *
 * Single fat endpoint covering finance (incomes vs spendings) and tasks for
 * a configurable time window. Returns a uniformly bucketed series the chart
 * can render without further bucketing on the client.
 */

function dashboardParams(filters?: DashboardFilters) {
  const params: Record<string, string> = {};
  if (filters?.period) params.period = filters.period;
  if (filters?.group_by) params.group_by = filters.group_by;
  if (filters?.from_date) params.from_date = filters.from_date;
  if (filters?.to_date) params.to_date = filters.to_date;
  return params;
}

export const dashboard = {
  analytics: (filters?: DashboardFilters) =>
    api
      .get<DashboardAnalytics>("/dashboard/analytics/", {
        params: dashboardParams(filters),
      })
      .then((r) => r.data),
  myTasks: (limit = 12) =>
    api
      .get<DashboardMyTasksAnalytics>("/dashboard/my-tasks/", {
        params: { limit },
      })
      .then((r) => r.data),
};

/* ---------------- Wallets ----------------
 *
 * Read-only for any authenticated user; mutating actions are gated by the
 * wallets_can_create / wallets_can_update / wallets_can_delete permissions
 * (or superuser/staff). Income/Spending create/update/delete cascade into
 * wallet balance + WalletLog entries on the backend automatically.
 */

export const wallets = {
  list: () =>
    api
      .get<Wallet[] | { results: Wallet[] }>("/wallets/")
      .then((r) => unwrap(r.data)),
  current: () =>
    api.get<Wallet>("/wallets/current/").then((r) => r.data),
  retrieve: (id: number) =>
    api.get<Wallet>(`/wallets/${id}/`).then((r) => r.data),
  create: (payload: WalletCreate) =>
    api.post<Wallet>("/wallets/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<WalletCreate>) =>
    api.patch<Wallet>(`/wallets/${id}/`, payload).then((r) => r.data),
  remove: (id: number) =>
    api.delete<void>(`/wallets/${id}/`).then((r) => r.data),
  logs: () =>
    api
      .get<WalletLog[] | { results: WalletLog[] }>("/wallets/logs/")
      .then((r) => unwrap(r.data)),
};
