from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate, TruncMonth, TruncWeek, TruncYear
from django.utils import timezone
from src.incomes.models import Income
from src.onboards.models import Task
from src.spendings.models import Spending
from src.telegram_bot.services.parser import ParsedCommand
from src.wallets.services import wallet_analytics


ZERO = Decimal("0.00")


class ReportBuilder:
    TRUNC_BY_GROUP = {
        "day": TruncDate,
        "week": TruncWeek,
        "month": TruncMonth,
        "year": TruncYear,
    }

    def build(self, command: ParsedCommand) -> str:
        date_from, date_to, group_by = self._date_range(command)
        incomes = Income.objects.filter(date_earned__range=(date_from, date_to))
        spendings = Spending.objects.filter(date_spend__range=(date_from, date_to))
        tasks = Task.objects.filter(date_end__range=(date_from, date_to))
        income_total = self._sum_amount(incomes)
        spending_total = self._sum_amount(spendings)
        net_total = income_total - spending_total
        wallets = wallet_analytics(date_from=date_from, date_to=date_to)

        lines = [
            f"Report: {date_from.isoformat()} - {date_to.isoformat()}",
            "",
            f"Wallets:  {self._money(wallets['totals']['balance'])} KZT",
            f"Income:   {self._money(income_total)} KZT",
            f"Spending: {self._money(spending_total)} KZT",
            f"Net:      {self._money(net_total)} KZT",
            "",
        ]
        lines.extend(self._wallets_section(wallets))
        lines.extend(self._type_section("Income by type", incomes, "amount"))
        lines.extend(self._type_section("Spending by type", spendings, "amount"))
        lines.extend(
            self._finance_timeline(
                incomes,
                spendings,
                date_from,
                date_to,
                group_by,
            )
        )
        lines.extend(self._tasks_section(tasks, group_by, date_from, date_to))

        return "\n".join(lines).strip()

    def _wallets_section(self, analytics) -> list[str]:
        rows = [
            row
            for row in analytics["wallets"]
            if row["is_active"]
            or Decimal(row["income_total"]) or Decimal(row["spending_total"])
        ]

        if not rows:
            return []

        lines = ["By wallet"]

        for row in rows:
            star = "*" if row["is_default"] else " "
            lines.append(
                f"{star}{row['name'][:14]:14} {self._money(row['balance'])} KZT "
                f"(+{self._money(row['income_total'])} / "
                f"-{self._money(row['spending_total'])})"
            )

        lines.append("")
        return lines

    def _date_range(self, command: ParsedCommand) -> tuple[date, date, str]:
        today = timezone.localdate()
        period = command.period or "month"
        date_to = command.date_to or today

        if command.date_from:
            date_from = command.date_from
        elif period == "week":
            date_from = date_to - timedelta(days=date_to.weekday())
        elif period == "year":
            date_from = date(date_to.year, 1, 1)
        elif period == "all":
            date_from = self._first_known_date(date_to)
        else:
            date_from = date(date_to.year, date_to.month, 1)

        if date_from > date_to:
            date_from, date_to = date_to, date_from

        span_days = (date_to - date_from).days
        group_by = "month" if span_days > 90 else "day"

        return date_from, date_to, group_by

    def _first_known_date(self, fallback: date) -> date:
        values = [
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
        known = [value for value in values if value]
        return min(known) if known else fallback

    def _sum_amount(self, queryset) -> Decimal:
        return queryset.aggregate(total=Sum("amount"))["total"] or ZERO

    def _type_section(self, title: str, queryset, amount_field: str) -> list[str]:
        rows = list(
            queryset.values("type")
            .annotate(total=Sum(amount_field), count=Count("id"))
            .order_by("-total", "type")[:8]
        )

        if not rows:
            return [title, "No data", ""]

        max_value = max(row["total"] or ZERO for row in rows)
        lines = [title]

        for row in rows:
            label = row["type"] or "unknown"
            total = row["total"] or ZERO
            lines.append(
                f"{label[:14]:14} {self._bar(total, max_value)} "
                f"{self._money(total)} KZT ({row['count']})"
            )

        lines.append("")
        return lines

    def _finance_timeline(
        self,
        incomes,
        spendings,
        date_from: date,
        date_to: date,
        group_by: str,
    ) -> list[str]:
        income_rows = self._bucket_amounts(incomes, "date_earned", group_by)
        spending_rows = self._bucket_amounts(spendings, "date_spend", group_by)
        buckets = self._bucket_list(date_from, date_to, group_by)
        rows = []

        for bucket in buckets[-12:]:
            income_total = income_rows.get(bucket, ZERO)
            spending_total = spending_rows.get(bucket, ZERO)
            rows.append((bucket, income_total, spending_total, income_total - spending_total))

        if not rows:
            return ["Finance timeline", "No data", ""]

        max_value = max(abs(row[3]) for row in rows) or ZERO
        lines = ["Finance timeline"]

        for bucket, income_total, spending_total, net_total in rows:
            label = self._bucket_label(bucket, group_by)
            lines.append(
                f"{label:10} {self._bar(abs(net_total), max_value)} "
                f"net {self._money(net_total)} "
                f"(+{self._money(income_total)} / -{self._money(spending_total)})"
            )

        lines.append("")
        return lines

    def _tasks_section(
        self,
        tasks,
        group_by: str,
        date_from: date,
        date_to: date,
    ) -> list[str]:
        today = timezone.localdate()
        counters = {
            "total": Count("id"),
            "active": Count("id", filter=Q(is_active=True)),
            "overdue": Count("id", filter=Q(is_active=True, date_end__lt=today)),
        }
        by_type = list(tasks.values("type").annotate(**counters).order_by("-total", "type")[:8])
        total_tasks = sum(row["total"] for row in by_type)
        lines = ["Tasks by type"]

        if not by_type:
            lines.extend(["No data", ""])
        else:
            max_value = max(row["total"] for row in by_type)

            for row in by_type:
                lines.append(
                    f"{(row['type'] or 'unknown')[:14]:14} "
                    f"{self._bar(row['total'], max_value)} "
                    f"{row['total']} total, {row['active']} active, {row['overdue']} overdue"
                )

            lines.append(f"Tasks total: {total_tasks}")
            lines.append("")

        lines.extend(self._tasks_timeline(tasks, group_by, date_from, date_to))
        return lines

    def _tasks_timeline(
        self,
        tasks,
        group_by: str,
        date_from: date,
        date_to: date,
    ) -> list[str]:
        rows_by_bucket = self._bucket_counts(tasks, "date_end", group_by)
        buckets = self._bucket_list(date_from, date_to, group_by)[-12:]

        if not buckets:
            return ["Tasks by term", "No data", ""]

        max_value = max(rows_by_bucket.get(bucket, 0) for bucket in buckets) or 0
        lines = ["Tasks by term"]

        for bucket in buckets:
            total = rows_by_bucket.get(bucket, 0)
            lines.append(
                f"{self._bucket_label(bucket, group_by):10} "
                f"{self._bar(total, max_value)} {total}"
            )

        lines.append("")
        return lines

    def _bucket_amounts(self, queryset, date_field: str, group_by: str) -> dict[date, Decimal]:
        trunc = self.TRUNC_BY_GROUP[group_by]
        rows = (
            queryset.annotate(bucket=trunc(date_field))
            .values("bucket")
            .annotate(total=Sum("amount"))
        )
        return {
            self._bucket_start(row["bucket"], group_by): row["total"] or ZERO
            for row in rows
        }

    def _bucket_counts(self, queryset, date_field: str, group_by: str) -> dict[date, int]:
        trunc = self.TRUNC_BY_GROUP[group_by]
        rows = (
            queryset.annotate(bucket=trunc(date_field))
            .values("bucket")
            .annotate(total=Count("id"))
        )
        return {
            self._bucket_start(row["bucket"], group_by): row["total"]
            for row in rows
        }

    def _bucket_list(self, date_from: date, date_to: date, group_by: str) -> list[date]:
        buckets = []
        current = self._bucket_start(date_from, group_by)
        end = self._bucket_start(date_to, group_by)

        while current <= end:
            buckets.append(current)
            current = self._next_bucket(current, group_by)

        return buckets

    def _bucket_start(self, value, group_by: str) -> date:
        if hasattr(value, "date"):
            value = value.date()

        if group_by == "week":
            return value - timedelta(days=value.weekday())

        if group_by == "month":
            return date(value.year, value.month, 1)

        if group_by == "year":
            return date(value.year, 1, 1)

        return value

    def _next_bucket(self, value: date, group_by: str) -> date:
        if group_by == "week":
            return value + timedelta(days=7)

        if group_by == "month":
            if value.month == 12:
                return date(value.year + 1, 1, 1)

            return date(value.year, value.month + 1, 1)

        if group_by == "year":
            return date(value.year + 1, 1, 1)

        return value + timedelta(days=1)

    def _bucket_label(self, value: date, group_by: str) -> str:
        if group_by == "month":
            return value.strftime("%Y-%m")

        if group_by == "year":
            return str(value.year)

        return value.strftime("%m-%d")

    def _bar(self, value, max_value, width: int = 12) -> str:
        if not max_value:
            filled = 0
        else:
            filled = int((Decimal(value) / Decimal(max_value)) * width)
            filled = max(1 if value else 0, min(width, filled))

        return "[" + "#" * filled + "." * (width - filled) + "]"

    def _money(self, amount) -> str:
        value = Decimal(amount or ZERO)

        if value == value.quantize(Decimal("1")):
            return f"{value:,.0f}"

        return f"{value:,.2f}"
