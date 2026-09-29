from core.permissions import AccountingPermissions
from core.views import BasePermissionMixin, BaseSerializerMixin
from django.db import transaction
from django.db.models import Count, Min, Max, Sum
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from src.incomes.filters import IncomeFilter
from src.incomes.models import Income
from src.incomes.serializers import IncomeSerializer
from src.wallets.services import (
    record_income_created,
    record_income_deleted,
    record_income_updated,
)


class IncomeViewSet(
    BasePermissionMixin,
    BaseSerializerMixin,
    viewsets.ModelViewSet,
):
    queryset = Income.objects.select_related("wallet").order_by("-date_earned", "-id")
    serializer_class = IncomeSerializer
    permission_classes = (AccountingPermissions,)

    filter_backends = [DjangoFilterBackend]
    filterset_class = IncomeFilter

    def perform_create(self, serializer):
        with transaction.atomic():
            income = serializer.save()
            record_income_created(income, actor=self.request.user)

    def perform_update(self, serializer):
        with transaction.atomic():
            old_amount = serializer.instance.amount
            old_wallet_id = serializer.instance.wallet_id
            income = serializer.save()
            record_income_updated(
                income,
                old_amount=old_amount,
                old_wallet_id=old_wallet_id,
                actor=self.request.user,
            )

    def perform_destroy(self, instance):
        with transaction.atomic():
            record_income_deleted(instance, actor=self.request.user)
            instance.delete()

    def _filtered_without(self, *ignored_params):
        params = self.request.query_params.copy()

        for param in ignored_params:
            params.pop(param, None)

        return IncomeFilter(
            params,
            queryset=self.get_queryset(),
            request=self.request,
        ).qs

    @action(detail=False, methods=["get"], url_path="analytics")
    def analytics(self, request):
        filtered = self.filter_queryset(self.get_queryset())

        by_type = self._filtered_without("type").values("type").annotate(
            count=Count("id"),
            total_amount=Sum("amount"),
        ).order_by("-total_amount")

        by_date = filtered.values("date_earned").annotate(
            count=Count("id"),
            total_amount=Sum("amount"),
        ).order_by("date_earned")

        by_wallet = self._filtered_without("wallet").values(
            "wallet_id",
            "wallet__name",
        ).annotate(
            count=Count("id"),
            total_amount=Sum("amount"),
        ).order_by("-total_amount")

        total = filtered.aggregate(
            count=Count("id"),
            total_amount=Sum("amount"),
            max_amount=Max("amount"),
            date_from=Min("date_earned"),
            date_to=Max("date_earned"),
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
            },
        })
