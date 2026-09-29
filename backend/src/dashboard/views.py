from datetime import date, timedelta
from decimal import Decimal

from core.permissions import AccountingPermissions, can_view_wallet_balance
from django.db.models import Case, Count, IntegerField, Q, Sum, Value, When
from django.db.models.functions import TruncDate, TruncMonth, TruncWeek, TruncYear
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from src.incomes.models import Income
from src.onboards.models import Task
from src.spendings.models import Spending
from src.wallets.models import Wallet


ZERO_AMOUNT = Decimal("0.00")


class DashboardViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated, AccountingPermissions]

    PERIODS = {"week", "month", "year", "all", "custom"}
    GROUPS = {"day", "week", "month", "year"}
    TASK_LIMIT_DEFAULT = 12
    TASK_LIMIT_MAX = 200
    TASK_WORKLOAD_CAPACITY_POINTS = 12
    TRUNC_BY_GROUP = {
        "day": TruncDate,
        "week": TruncWeek,
        "month": TruncMonth,
        "year": TruncYear,
    }

    @action(detail=False, methods=["get"], url_path="analytics")
    def analytics(self, request):
        params, error = self._date_params(request)

        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)

        incomes = Income.objects.filter(
            date_earned__gte=params["date_from"],
            date_earned__lte=params["date_to"],
        )
        spendings = Spending.objects.filter(
            date_spend__gte=params["date_from"],
            date_spend__lte=params["date_to"],
        )
        tasks = Task.objects.filter(
            date_end__gte=params["date_from"],
            date_end__lte=params["date_to"],
        )

        return Response(
            {
                "meta": params,
                "finance": self._finance(incomes, spendings, params),
                "tasks": self._tasks(tasks, params),
            }
        )

    @action(detail=False, methods=["get"], url_path="my-tasks")
    def my_tasks(self, request):
        today = timezone.localdate()
        limit = self._task_limit(request)
        tasks = self._my_tasks_queryset(request.user)
        open_tasks = tasks.filter(self._open_task_q())
        summary = self._my_task_summary(tasks, open_tasks, today)

        ordered_tasks = (
            open_tasks.annotate(
                urgency_order=Case(
                    When(date_end__lt=today, then=Value(0)),
                    When(date_end=today, then=Value(1)),
                    When(date_end__lte=today + timedelta(days=3), then=Value(2)),
                    When(date_end__lte=today + timedelta(days=7), then=Value(3)),
                    default=Value(4),
                    output_field=IntegerField(),
                )
            )
            .order_by("urgency_order", "date_end", "id")[:limit]
        )

        return Response(
            {
                "summary": summary,
                "by_status": self._my_tasks_by_status(tasks),
                "by_type": self._my_tasks_by_type(open_tasks),
                "tasks": [
                    self._my_task_row(task, today)
                    for task in ordered_tasks
                ],
            }
        )

    def _date_params(self, request):
        today = timezone.localdate()
        query = request.query_params
        period = query.get("period", "month")
        group_by = query.get("group_by")

        if period not in self.PERIODS:
            period = "month"

        date_from = parse_date(query["from_date"]) if "from_date" in query else None
        date_to = parse_date(query["to_date"]) if "to_date" in query else today

        if "from_date" in query and date_from is None:
            return None, "Invalid from_date. Use YYYY-MM-DD."

        if "to_date" in query and date_to is None:
            return None, "Invalid to_date. Use YYYY-MM-DD."

        if "from_date" in query or "to_date" in query:
            period = "custom"

        if date_from is None:
            if period == "week":
                date_from = date_to - timedelta(days=date_to.weekday())
            elif period == "year":
                date_from = date(date_to.year, 1, 1)
            elif period == "all":
                first_dates = [
                    Income.objects.order_by("date_earned")
                    .values_list("date_earned", flat=True)
                    .first(),
                    Spending.objects.order_by("date_spend")
                    .values_list("date_spend", flat=True)
                    .first(),
                    Task.objects.order_by("date_end")
                    .values_list("date_end", flat=True)
                    .first(),
                ]
                date_from = (
                    min(value for value in first_dates if value)
                    if any(first_dates)
                    else date_to
                )
            else:
                date_from = date(date_to.year, date_to.month, 1)

        if date_from > date_to:
            return None, "from_date must be before or equal to to_date."

        if group_by not in self.GROUPS:
            group_by = "month" if period in {"year", "all"} else "day"

        return {
            "period": period,
            "group_by": group_by,
            "date_from": date_from,
            "date_to": date_to,
        }, None

    def _finance(self, incomes, spendings, params):
        selected = self._amount_summary(incomes, spendings)
        all_time = self._amount_summary(Income.objects.all(), Spending.objects.all())
        income_series = self._bucket_data(
            incomes,
            "date_earned",
            params,
            {"count": Count("id"), "total_amount": Sum("amount")},
            {"count": 0, "total_amount": ZERO_AMOUNT},
        )
        spending_series = self._bucket_data(
            spendings,
            "date_spend",
            params,
            {"count": Count("id"), "total_amount": Sum("amount")},
            {"count": 0, "total_amount": ZERO_AMOUNT},
        )

        return {
            "summary": selected,
            "all_time": all_time,
            "wallet": self._wallet(),
            "series": [
                {
                    "date": income["date"],
                    "income_count": income["count"],
                    "income_total": income["total_amount"],
                    "spending_count": spending["count"],
                    "spending_total": spending["total_amount"],
                    "net_total": income["total_amount"] - spending["total_amount"],
                }
                for income, spending in zip(income_series, spending_series, strict=True)
            ],
            "by_type": {
                "incomes": list(
                    incomes.values("type")
                    .annotate(count=Count("id"), total_amount=Sum("amount"))
                    .order_by("type")
                ),
                "spendings": list(
                    spendings.values("type")
                    .annotate(count=Count("id"), total_amount=Sum("amount"))
                    .order_by("type")
                ),
            },
        }

    def _wallet(self):
        wallet = Wallet.default()
        can_view_balance = can_view_wallet_balance(self.request.user)
        active = Wallet.objects.filter(is_active=True)
        total_balance = active.aggregate(total=Sum("balance"))["total"] or ZERO_AMOUNT
        return {
            "id": wallet.id,
            "name": wallet.name,
            "balance": wallet.balance if can_view_balance else None,
            "total_balance": total_balance if can_view_balance else None,
            "wallets_count": active.count(),
            "can_view_balance": can_view_balance,
            "updated_at": wallet.updated_at,
        }

    def _tasks(self, tasks, params):
        today = timezone.localdate()
        counters = {
            "total": Count("id"),
            "active": Count("id", filter=Q(is_active=True)),
            "inactive": Count("id", filter=Q(is_active=False)),
            "overdue": Count("id", filter=Q(is_active=True, date_end__lt=today)),
        }

        return {
            "summary": tasks.aggregate(**counters),
            "by_type": list(tasks.values("type").annotate(**counters).order_by("type")),
            "by_date_term": self._bucket_data(
                tasks,
                "date_end",
                params,
                counters,
                {"total": 0, "active": 0, "inactive": 0, "overdue": 0},
            ),
        }

    def _amount_summary(self, incomes, spendings):
        income = incomes.aggregate(count=Count("id"), total_amount=Sum("amount"))
        spending = spendings.aggregate(count=Count("id"), total_amount=Sum("amount"))
        income_total = income["total_amount"] or ZERO_AMOUNT
        spending_total = spending["total_amount"] or ZERO_AMOUNT

        return {
            "income_count": income["count"],
            "income_total": income_total,
            "spending_count": spending["count"],
            "spending_total": spending_total,
            "net_total": income_total - spending_total,
        }

    def _bucket_data(self, queryset, date_field, params, annotations, defaults):
        group_by = params["group_by"]
        trunc = self.TRUNC_BY_GROUP[group_by]
        rows = (
            queryset.annotate(bucket=trunc(date_field))
            .values("bucket")
            .annotate(**annotations)
            .order_by("bucket")
        )
        rows_by_bucket = {
            self._bucket_start(row["bucket"], group_by): row
            for row in rows
        }

        result = []
        current = self._bucket_start(params["date_from"], group_by)
        end = self._bucket_start(params["date_to"], group_by)

        while current <= end:
            row = rows_by_bucket.get(current, {})
            result.append(
                {
                    "date": current,
                    **{
                        key: row.get(key) if row.get(key) is not None else default
                        for key, default in defaults.items()
                    },
                }
            )
            current = self._next_bucket(current, group_by)

        return result

    def _bucket_start(self, value, group_by):
        if hasattr(value, "date"):
            value = value.date()

        if group_by == "week":
            return value - timedelta(days=value.weekday())

        if group_by == "month":
            return date(value.year, value.month, 1)

        if group_by == "year":
            return date(value.year, 1, 1)

        return value

    def _task_limit(self, request):
        raw_limit = request.query_params.get("limit", self.TASK_LIMIT_DEFAULT)

        try:
            limit = int(raw_limit)
        except (TypeError, ValueError):
            limit = self.TASK_LIMIT_DEFAULT

        return max(1, min(limit, self.TASK_LIMIT_MAX))

    def _my_tasks_queryset(self, user):
        return (
            Task.objects.filter(taskperformance__user=user)
            .select_related(
                "category",
                "category__onboard",
                "category__onboard__deal",
                "deal_stage",
                "deal_stage__deal",
                "deal_stage__parent_stage",
            )
            .distinct()
        )

    def _open_task_q(self):
        return (
            Q(is_active=True)
            & ~Q(status__in=[Task.Status.DONE, Task.Status.CANCELLED])
            & ~Q(approval_status=Task.ApprovalStatus.CANCELLED)
        )

    def _my_task_summary(self, tasks, open_tasks, today):
        overdue = open_tasks.filter(date_end__lt=today).count()
        due_today = open_tasks.filter(date_end=today).count()
        due_next_3_days = open_tasks.filter(
            date_end__gt=today,
            date_end__lte=today + timedelta(days=3),
        ).count()
        due_next_7_days = open_tasks.filter(
            date_end__gt=today,
            date_end__lte=today + timedelta(days=7),
        ).count()
        open_count = open_tasks.count()
        completed = tasks.filter(status=Task.Status.DONE).count()
        cancelled = tasks.filter(
            Q(status=Task.Status.CANCELLED)
            | Q(approval_status=Task.ApprovalStatus.CANCELLED)
        ).count()

        return {
            "assigned_total": tasks.count(),
            "open": open_count,
            "completed": completed,
            "cancelled": cancelled,
            "overdue": overdue,
            "due_today": due_today,
            "due_next_3_days": due_next_3_days,
            "due_next_7_days": due_next_7_days,
            "workload": self._workload(
                open_count,
                overdue,
                due_today,
                due_next_3_days,
                due_next_7_days,
            ),
        }

    def _workload(
        self,
        open_count,
        overdue,
        due_today,
        due_next_3_days,
        due_next_7_days,
    ):
        due_days_4_to_7 = max(due_next_7_days - due_next_3_days, 0)
        points = (
            open_count
            + overdue * 2
            + due_today * 1.5
            + due_next_3_days * 0.75
            + due_days_4_to_7 * 0.35
        )
        percent = min(
            100,
            round((points / self.TASK_WORKLOAD_CAPACITY_POINTS) * 100),
        )

        if percent == 0:
            label = "Нет активных задач"
        elif percent < 35:
            label = "Низкая загрузка"
        elif percent < 70:
            label = "Нормальная загрузка"
        elif percent < 90:
            label = "Высокая загрузка"
        else:
            label = "Перегруз"

        return {
            "percent": percent,
            "label": label,
            "points": round(points, 1),
            "capacity_points": self.TASK_WORKLOAD_CAPACITY_POINTS,
        }

    def _my_tasks_by_status(self, tasks):
        counts = {status: 0 for status, _ in Task.Status.choices}
        rows = tasks.values("status").annotate(count=Count("id")).order_by("status")

        for row in rows:
            counts[row["status"]] = row["count"]

        return counts

    def _my_tasks_by_type(self, open_tasks):
        return list(
            open_tasks.values("type")
            .annotate(count=Count("id"))
            .order_by("-count", "type")[:8]
        )

    def _my_task_row(self, task, today):
        onboard = task.category.onboard if task.category_id else None
        stage = task.deal_stage if task.deal_stage_id else None
        deal = onboard.deal if onboard and onboard.deal_id else None

        if deal is None and stage is not None:
            deal = stage.deal

        days_left = (task.date_end - today).days

        return {
            "id": task.id,
            "name": task.name,
            "type": task.type,
            "status": task.status,
            "date_start": task.date_start,
            "date_end": task.date_end,
            "days_left": days_left,
            "urgency": self._task_urgency(days_left),
            "category": task.category_id,
            "category_name": task.category.name if task.category_id else "",
            "onboard": onboard.id if onboard else None,
            "onboard_name": onboard.name if onboard else "",
            "deal": deal.id if deal else None,
            "deal_name": deal.name if deal else "",
            "deal_stage": stage.id if stage else None,
            "deal_stage_status": stage.status if stage else "",
            "deal_stage_name": stage.name if stage else "",
            "parent_stage_name": (
                stage.parent_stage.name if stage and stage.parent_stage_id else ""
            ),
            "approval_status": task.approval_status,
            "approval_action": task.approval_action,
        }

    def _task_urgency(self, days_left):
        if days_left < 0:
            return "overdue"

        if days_left == 0:
            return "today"

        if days_left <= 3:
            return "next_3_days"

        if days_left <= 7:
            return "next_7_days"

        return "later"

    def _next_bucket(self, value, group_by):
        if group_by == "week":
            return value + timedelta(days=7)

        if group_by == "month":
            if value.month == 12:
                return date(value.year + 1, 1, 1)

            return date(value.year, value.month + 1, 1)

        if group_by == "year":
            return date(value.year + 1, 1, 1)

        return value + timedelta(days=1)
