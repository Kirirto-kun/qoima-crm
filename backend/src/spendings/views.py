from core.permissions import AccountingPermissions
from core.views import BasePermissionMixin, BaseSerializerMixin
from django.db import transaction
from django.db.models import Q
from django.db.models.aggregates import Sum, Count, Min, Max
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from src.spendings.filters import SpendingFilter
from src.spendings.serializers import (
    MonthlyObligationSerializer,
    SpendingSerializer,
)

from src.spendings.models import MonthlyObligation, Spending
from src.spendings.services import (
    charge_due_monthly_obligations,
    clear_monthly_obligation_current_month_exclusion,
    exclude_monthly_obligation_current_month,
)
from src.wallets.services import (
    record_spending_created,
    record_spending_deleted,
    record_spending_updated,
)


# Create your views here.
class SpendingViewSet(
    BasePermissionMixin,
    BaseSerializerMixin,
    viewsets.ModelViewSet,
):
    queryset = Spending.objects.select_related("wallet").order_by("-date_spend", "-id")
    serializer_class = SpendingSerializer
    permission_classes = (AccountingPermissions,)

    filter_backends = [DjangoFilterBackend]
    filterset_class = SpendingFilter

    def perform_create(self, serializer):
        with transaction.atomic():
            spending = serializer.save()
            record_spending_created(spending, actor=self.request.user)

    def perform_update(self, serializer):
        with transaction.atomic():
            old_amount = serializer.instance.amount
            old_wallet_id = serializer.instance.wallet_id
            spending = serializer.save()
            record_spending_updated(
                spending,
                old_amount=old_amount,
                old_wallet_id=old_wallet_id,
                actor=self.request.user,
            )

    def perform_destroy(self, instance):
        with transaction.atomic():
            record_spending_deleted(instance, actor=self.request.user)
            instance.delete()

    def _filtered_without(self, *ignored_params):
        params = self.request.query_params.copy()

        for param in ignored_params:
            params.pop(param, None)

        return SpendingFilter(
            params,
            queryset=self.get_queryset(),
            request=self.request,
        ).qs

    @action(detail=False, methods=["get"], url_path="analytics")
    def analytics(self, request):
        filter_spending = self.filter_queryset(self.get_queryset())
        by_type = self._filtered_without("type").values("type").annotate(
            count=Count("id"),
            total_amount=Sum("amount"),
        ).order_by("-total_amount")

        by_date = filter_spending.values("date_spend").annotate(
            count=Count("id"),
            total_amount=Sum("amount"),
        ).order_by("date_spend")

        by_wallet = self._filtered_without("wallet").values(
            "wallet_id",
            "wallet__name",
        ).annotate(
            count=Count("id"),
            total_amount=Sum("amount"),
        ).order_by("-total_amount")

        total = filter_spending.aggregate(
            count=Count("id"),
            total_amount=Sum("amount"),
            max_amount=Max("amount"),
            date_from=Min("date_spend"),
            date_to=Max("date_spend"),
        )

        return Response({
            "total": total,
            "by_date": list(by_date),
            "by_type": list(by_type),
            "by_wallet": [
                {
                    "wallet": row["wallet_id"],
                    "wallet_name": row["wallet__name"],
                    "count": row["count"],
                    "total_amount": row["total_amount"],
                }
                for row in by_wallet
            ],
            "meta": {
                "date_from": total["date_from"],
                "date_to": total["date_to"],
            }
        })


class MonthlyObligationViewSet(
    BasePermissionMixin,
    BaseSerializerMixin,
    viewsets.ModelViewSet,
):
    queryset = MonthlyObligation.objects.all()
    serializer_class = MonthlyObligationSerializer
    permission_classes = (AccountingPermissions,)

    def get_queryset(self):
        queryset = MonthlyObligation.objects.select_related("wallet").order_by(
            "due_date",
            "id",
        )
        request = getattr(self, "request", None)
        params = getattr(request, "query_params", {})
        active = params.get("active")
        search = params.get("search", "").strip()

        if active in {"true", "1", "yes"}:
            queryset = queryset.filter(is_active=True)
        elif active in {"false", "0", "no"}:
            queryset = queryset.filter(is_active=False)

        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(type__icontains=search)
                | Q(note__icontains=search)
            )

        return queryset

    @action(detail=False, methods=["get"], url_path="analytics")
    def analytics(self, request):
        queryset = self.get_queryset()
        active_queryset = queryset.filter(is_active=True)

        by_type = active_queryset.values("type").annotate(
            count=Count("id"),
            total_amount=Sum("amount"),
        )
        total = active_queryset.aggregate(
            count=Count("id"),
            total_amount=Sum("amount"),
        )

        return Response(
            {
                "total": total,
                "by_type": list(by_type),
            }
        )

    @action(detail=True, methods=["post"], url_path="exclude-current-month")
    def exclude_current_month(self, request, pk=None):
        result = exclude_monthly_obligation_current_month(
            self.get_object().pk,
            actor=request.user,
        )
        obligation = MonthlyObligation.objects.get(pk=pk)
        serializer = self.get_serializer(obligation)

        return Response(
            {
                "obligation": serializer.data,
                "removed_spending_id": result["removed_spending_id"],
                "wallet_balance": result["wallet_balance"],
            }
        )

    @action(detail=True, methods=["post"], url_path="clear-current-month-exclusion")
    def clear_current_month_exclusion(self, request, pk=None):
        clear_monthly_obligation_current_month_exclusion(self.get_object().pk)
        obligation = MonthlyObligation.objects.get(pk=pk)
        serializer = self.get_serializer(obligation)

        return Response({"obligation": serializer.data})

    @action(detail=False, methods=["post"], url_path="charge-due")
    def charge_due(self, request):
        dry_run = request.data.get("dry_run") in {True, "true", "1", 1}
        notify = request.data.get("notify", True) not in {False, "false", "0", 0}
        return Response(
            charge_due_monthly_obligations(
                notify=notify,
                dry_run=dry_run,
            )
        )
