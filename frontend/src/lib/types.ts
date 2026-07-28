export type UserRole = "collaborator" | "employee";
export type DealPaymentType = "cash" | "card" | "loan";
export type DealStageStatus = "pending" | "in_progress" | "completed";

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  telegram_id?: number | null;
  /** Optional — present once backend adds it to /api/users/profile/. */
  is_superuser?: boolean;
  is_staff?: boolean;
}

/* -------------------- Clients (admin-side) -------------------- */

export interface ClientProject {
  id: number;
  name: string;
}

export interface Client {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  projects: ClientProject[];
}

export interface ClientCreate {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
}

export interface ClientUpdate {
  email?: string;
  first_name?: string;
  last_name?: string;
}

/* -------------------- Employees -------------------- */

export const EMPLOYEE_PERMISSION_FIELDS = [
  "tasks_can_edit",
  "tasks_can_delete",
  "tasks_can_create",
  "accounting_can_retrieve",
  "accounting_can_create",
  "accounting_can_update",
  "accounting_can_delete",
  "deals_can_create",
  "deals_can_delete",
  "deals_can_update",
  "employees_can_delete",
  "employees_can_create",
  "employees_can_update",
  "wallets_can_create",
  "wallets_can_update",
  "wallets_can_delete",
  "wallets_can_view_balance",
  "deals_can_view_amount",
  "sales_can_retrieve",
  "sales_can_create",
  "sales_can_update",
  "sales_can_delete",
  "clients_can_retrieve",
  "clients_can_create",
  "clients_can_update",
  "clients_can_delete",
] as const;

export type EmployeePermissionField = (typeof EMPLOYEE_PERMISSION_FIELDS)[number];

export type EmployeePermissions = Record<EmployeePermissionField, boolean>;

export interface Employee extends EmployeePermissions {
  id: number;
  /**
   * Depending on backend serializer, `user` arrives either as the FK id
   * (number) or as a nested User object. Use the `employeeUserId()` /
   * `employeeUserDisplay()` helpers to extract either safely.
   */
  user: number | User;
  role: string;
  salary: string;
}

export interface EmployeeDetail extends Employee {
  user_detail?: User;
}

/* -------------------- Deals -------------------- */

export interface Deal {
  id: number;
  name: string;
  /** Either the FK id or the full nested User (depends on backend serializer). */
  user: number | User | null;
  stage: string;
  date_start: string;
  date_end: string;
  deal_amount: string | null;
  payment_type: DealPaymentType;
  is_active: boolean;
  /** Optional until backend migration lands everywhere. */
  is_archived?: boolean;
  payment_completed: boolean;

  /**
   * Optional fields that arrive once backend opts in:
   *   - `user_detail` — nested User (DealSerializer should add
   *     `user_detail = UserSerializer(source="user", read_only=True)`).
   *   - `paid_to_date` / `remaining` — annotated Sum of related payments.
   *   - `collaborators` / `collaborator_details` — extra collaborators on the
   *     deal beyond the primary `user`.
   */
  user_detail?: User;
  collaborators?: number[];
  collaborator_details?: User[];
  responsibles?: number[];
  responsible_details?: User[];
  stages?: DealStage[];
  links?: DealLink[];
  files?: DealFile[];
  payments?: DealPayment[];
  paid_to_date?: string | null;
  remaining?: string | null;
  can_view_amount?: boolean;
  progress_percent?: number;
  current_stage_name?: string;

  /** Derived from `user_detail` if backend gave it. */
  client_name?: string;
  client_email?: string;
}

export interface DealCreate {
  name?: string;
  stage: string;
  date_start?: string;
  date_end: string;
  deal_amount: string;
  payment_type: DealPaymentType;
  user?: number;
  collaborators?: number[];
  responsibles?: number[];
  is_archived?: boolean;
}

export interface DealStage {
  id: number;
  deal: number;
  parent_stage: number | null;
  name: string;
  status: DealStageStatus;
  order: number;
  responsible: number | null;
  responsible_detail?: User | null;
  due_date: string | null;
  completed_at: string | null;
}

export interface DealStageCreate {
  name: string;
  parent_stage?: number | null;
  status?: DealStageStatus;
  order?: number;
  responsible?: number | null;
  due_date?: string | null;
  completed_at?: string | null;
}

export interface DealLink {
  id: number;
  deal: number;
  title: string;
  url: string;
  description: string;
}

export interface DealLinkCreate {
  title: string;
  url: string;
  description?: string;
}

export interface DealFile {
  id: number;
  deal: number;
  file_name: string;
  file: string;
  file_url?: string;
  description: string | null;
}

export interface DealFileCreate {
  file_name: string;
  file: File | string;
  description?: string;
}

export interface DealPayment {
  id: number;
  deal: number;
  amount: string | null;
  can_view_amount?: boolean;
  payment_date: string;
  delayed: boolean;
}

export interface DealPaymentCreate {
  amount: string;
  payment_date?: string;
  delayed?: boolean;
}

/* -------------------- Onboards / Tasks -------------------- */

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";
export type TaskApprovalAction = "create" | "cancel" | "";
export type TaskCreatedVia = "api" | "telegram" | "admin" | string;
export type TaskAttachmentKind = "file" | "voice";

export type TaskAuditAction =
  | "created"
  | "updated"
  | "approval_requested"
  | "cancellation_requested"
  | "approved"
  | "rejected"
  | "cancelled"
  | "assigned"
  | "unassigned"
  | "attachment_added"
  | "attachment_removed"
  | string;

export interface TaskAuditLog {
  id: number;
  task: number;
  task_id_snapshot?: number | null;
  action: TaskAuditAction;
  source?: TaskCreatedVia;
  actor: number | null;
  actor_detail?: User | null;
  description?: string;
  metadata?: Record<string, unknown>;
  /** Optional human-readable note (e.g. rejection reason). */
  message?: string | null;
  /** Optional structured diff returned by the backend. */
  changes?: Record<string, unknown> | null;
  created_at: string;
}

export interface TaskPerformance {
  id: number;
  task: number;
  user: number;
  /** Present when backend includes nested user. */
  user_detail?: User;
}

export interface TaskAttachment {
  id: number;
  task: number;
  file: string;
  file_url: string;
  file_name: string;
  content_type: string;
  size: number;
  kind: TaskAttachmentKind;
  uploaded_by: number | null;
  uploaded_by_detail?: User | null;
  created_at: string;
}

export interface OnboardTask {
  id: number;
  category: number;
  name: string;
  type: string;
  status: TaskStatus;
  is_active: boolean;
  description: string;
  date_start: string;
  date_end: string;
  performance?: TaskPerformance[];
  attachments?: TaskAttachment[];

  /** Approval lifecycle — set by backend, especially for collaborator-created tasks. */
  approval_status?: TaskApprovalStatus;
  approval_action?: TaskApprovalAction;
  approval_requested_by?: number | null;
  approval_requested_by_detail?: User | null;
  approval_requested_at?: string | null;
  created_by?: number | null;
  created_by_detail?: User | null;
  created_via?: TaskCreatedVia;
  audit_logs?: TaskAuditLog[];

  // Frontend-only fields for now (backend will add these later).
  priority?: TaskPriority;
  assignee?: { id: number; name: string } | null;
}

export interface OnboardTaskCreate {
  category: number;
  name: string;
  type: string;
  description?: string;
  date_start: string;
  date_end: string;
  status?: TaskStatus;
  is_active?: boolean;
}

export interface TaskCategory {
  id: number;
  name: string;
  onboard: number | null;
  tasks?: OnboardTask[];
}

export interface TaskCategoryCreate {
  name: string;
  onboard: number;
}

export interface Onboard {
  id: number;
  deal: number | null;
  is_completed: boolean;
  term_of_end: string;
  /** Optional — present once backend adds `name` field to the model. */
  name?: string;
  categories?: TaskCategory[];

  // Derived on the client
  client_name?: string;
  progress?: number;
}

export interface OnboardCreate {
  deal?: number | null;
  term_of_end: string;
  is_completed?: boolean;
  name?: string;
}

export interface OnboardUpdate {
  deal?: number | null;
  term_of_end?: string;
  is_completed?: boolean;
  name?: string;
}

/* -------------------- Users -------------------- */

export interface UserCreate {
  username: string;
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  role: UserRole;
  telegram_id?: number | null;
}

export type UserUpdate = Partial<Omit<UserCreate, "password">>;

export interface PasswordResetConfirm {
  email: string;
  code: string;
  password: string;
}

/* -------------------- Incomes -------------------- */

export interface Income {
  id: number;
  name: string;
  type: string;
  amount: string;
  /**
   * Backend convention: keeping the field name consistent with Spending
   * (`date_spend` ↔ `date_earned`). If you go with a different name on the
   * server, update this single place.
   */
  date_earned: string;
  note: string | null;
}

export interface IncomeByType {
  type: string;
  count: number;
  total_amount: string;
}

export interface IncomeByDate {
  date_earned: string;
  count: number;
  total_amount: string;
}

export interface IncomeAnalytics {
  total: {
    count: number;
    total_amount: string | null;
    date_from: string | null;
    date_to: string | null;
  };
  by_date: IncomeByDate[];
  by_type: IncomeByType[];
  meta: {
    date_from: string | null;
    date_to: string | null;
  };
}

export interface IncomeFilters {
  from_date?: string;
  to_date?: string;
  type?: string;
}

export interface IncomeCreate {
  name: string;
  type: string;
  amount: string;
  note?: string;
}

/* -------------------- Sales -------------------- */

export type SalesHotLeadStatus =
  | "pending"
  | "in_progress"
  | "archived"
  | "deleted";

export interface SalesHotLead {
  id: number;
  name: string;
  contact: string;
  note: string;
  status: SalesHotLeadStatus;
  created_at: string;
  updated_at: string;
}

export interface SalesHotLeadCreate {
  name: string;
  contact: string;
  note?: string;
  status?: SalesHotLeadStatus;
}

export interface SalesLead {
  id: number;
  lead_name: string;
  company: string;
  amount: string;
  comments: string;
  created_at: string;
  updated_at: string;
}

export interface SalesLeadCreate {
  lead_name: string;
  company: string;
  amount: string;
  comments?: string;
}

export interface SalesEventParticipant {
  id: number;
  event: number;
  lead_name: string;
  company: string;
  amount: string;
  comments: string;
  created_at: string;
  updated_at: string;
}

export interface SalesEventParticipantCreate {
  event: number;
  lead_name: string;
  company?: string;
  amount: string;
  comments?: string;
}

export interface SalesEvent {
  id: number;
  name: string;
  event_date: string;
  capacity: number;
  comments: string;
  participant_count: number;
  total_amount: string;
  participants: SalesEventParticipant[];
  created_at: string;
  updated_at: string;
}

export interface SalesEventCreate {
  name: string;
  event_date: string;
  capacity: number;
  comments?: string;
}

/* -------------------- Spendings -------------------- */

export interface Spending {
  id: number;
  name: string;
  type: string;
  amount: string;
  date_spend: string;
  note: string | null;
}

export interface SpendingByType {
  type: string;
  count: number;
  total_amount: string;
}

export interface SpendingByDate {
  date_spend: string;
  count: number;
  total_amount: string;
}

export interface SpendingAnalytics {
  total: {
    count: number;
    total_amount: string | null;
    date_from: string | null;
    date_to: string | null;
  };
  by_date: SpendingByDate[];
  by_type: SpendingByType[];
  meta: {
    date_from: string | null;
    date_to: string | null;
  };
}

export interface SpendingFilters {
  from_date?: string;
  to_date?: string;
  type?: string;
}

export interface SpendingCreate {
  name: string;
  type: string;
  amount: string;
  note?: string;
}

export interface MonthlyObligation {
  id: number;
  name: string;
  type: string;
  amount: string;
  due_date: string;
  charge_day: number;
  is_active: boolean;
  note: string;
  last_charged_for: string | null;
  excluded_for: string | null;
  is_excluded_current_month: boolean;
  last_spending: number | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyObligationCreate {
  name: string;
  type: string;
  amount: string;
  due_date?: string;
  charge_day: number;
  is_active?: boolean;
  note?: string;
}

export interface MonthlyObligationByType {
  type: string;
  count: number;
  total_amount: string;
}

export interface MonthlyObligationAnalytics {
  total: {
    count: number;
    total_amount: string | null;
  };
  by_type: MonthlyObligationByType[];
}

export interface MonthlyObligationActionResult {
  obligation: MonthlyObligation;
  removed_spending_id?: number | null;
  wallet_balance?: string | null;
}

/* -------------------- Wallets -------------------- */

export interface Wallet {
  id: number;
  name: string;
  balance: string | null;
  can_view_balance: boolean;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WalletCreate {
  name: string;
  balance?: string;
  is_default?: boolean;
  is_active?: boolean;
}

export type WalletLogAction =
  | "wallet_created"
  | "wallet_updated"
  | "wallet_deleted"
  | "wallet_initialized"
  | "income_created"
  | "income_updated"
  | "income_deleted"
  | "spending_created"
  | "spending_updated"
  | "spending_deleted";

export interface WalletLog {
  id: number;
  wallet: number | null;
  wallet_name: string | null;
  actor: number | null;
  actor_detail: User | null;
  action: WalletLogAction;
  amount_delta: string | null;
  balance_before: string | null;
  balance_after: string | null;
  can_view_balance: boolean;
  description: string;
  related_object_type: string;
  related_object_id: string;
  created_at: string;
}

/* -------------------- Dashboard analytics -------------------- */

export type DashboardPeriod = "week" | "month" | "year" | "all" | "custom";
export type DashboardGroupBy = "day" | "week" | "month" | "year";

export interface DashboardFilters {
  period?: DashboardPeriod;
  group_by?: DashboardGroupBy;
  from_date?: string;
  to_date?: string;
}

export interface DashboardAmountSummary {
  income_count: number;
  income_total: string;
  spending_count: number;
  spending_total: string;
  net_total: string;
}

export interface DashboardFinancePoint {
  date: string;
  income_count: number;
  income_total: string;
  spending_count: number;
  spending_total: string;
  net_total: string;
}

export interface DashboardByTypeRow {
  type: string;
  count: number;
  total_amount: string;
}

export interface DashboardWalletSummary {
  id: number;
  name: string;
  balance: string | null;
  can_view_balance?: boolean;
  updated_at: string;
}

export interface DashboardFinance {
  summary: DashboardAmountSummary;
  all_time: DashboardAmountSummary;
  wallet: DashboardWalletSummary;
  series: DashboardFinancePoint[];
  by_type: {
    incomes: DashboardByTypeRow[];
    spendings: DashboardByTypeRow[];
  };
}

export interface DashboardTasksSummary {
  total: number;
  active: number;
  inactive: number;
  overdue: number;
}

export interface DashboardTasksByType extends DashboardTasksSummary {
  type: string;
}

export interface DashboardTasksByDate extends DashboardTasksSummary {
  date: string;
}

export interface DashboardTasks {
  summary: DashboardTasksSummary;
  by_type: DashboardTasksByType[];
  by_date_term: DashboardTasksByDate[];
}

export type DashboardTaskUrgency =
  | "overdue"
  | "today"
  | "next_3_days"
  | "next_7_days"
  | "later";

export interface DashboardMyTasksSummary {
  assigned_total: number;
  open: number;
  completed: number;
  cancelled: number;
  overdue: number;
  due_today: number;
  due_next_3_days: number;
  due_next_7_days: number;
  workload: {
    percent: number;
    label: string;
    points: number;
    capacity_points: number;
  };
}

export interface DashboardMyTasksByType {
  type: string;
  count: number;
}

export interface DashboardMyTaskItem {
  id: number;
  name: string;
  type: string;
  status: TaskStatus;
  date_start: string;
  date_end: string;
  days_left: number;
  urgency: DashboardTaskUrgency;
  category: number | null;
  category_name: string;
  onboard: number | null;
  onboard_name: string;
  deal: number | null;
  deal_name: string;
  /** Present when the task was auto-created from a project sub-stage. */
  deal_stage?: number | null;
  deal_stage_status?: DealStageStatus | "";
  deal_stage_name?: string;
  parent_stage_name?: string;
  approval_status: TaskApprovalStatus;
  approval_action: TaskApprovalAction;
}

export interface DashboardMyTasksAnalytics {
  summary: DashboardMyTasksSummary;
  by_status: Record<TaskStatus, number>;
  by_type: DashboardMyTasksByType[];
  tasks: DashboardMyTaskItem[];
}

export interface DashboardAnalytics {
  meta: {
    period: DashboardPeriod;
    group_by: DashboardGroupBy;
    date_from: string;
    date_to: string;
  };
  finance: DashboardFinance;
  tasks: DashboardTasks;
}

/* -------------------- Auth -------------------- */

export interface JWTPair {
  access: string;
  refresh: string;
}

export interface ApiError {
  detail?: string;
  [key: string]: unknown;
}
