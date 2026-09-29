from decimal import Decimal

from core.permissions import (
    WalletPermissions,
    WalletTransferPermissions,
    can_view_wallet_balance,
)
from django.db import transaction
from django.db.models import Q
from django.utils.dateparse import parse_date
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from src.wallets.models import Wallet, WalletLog, WalletTransfer
from src.wallets.serializers import (
    WalletLogSerializer,
    WalletSerializer,
    WalletTransferSerializer,
)
from src.wallets.services import (
    create_transfer,
    delete_transfer,
    log_wallet_change,
    wallet_analytics,
    wallet_in_use,
)


def _date_param(request, name):
    value = request.query_params.get(name)

    if not value:
        return None

    parsed = parse_date(value)

    if parsed is None:
        raise ValidationError({name: "Use YYYY-MM-DD."})

    return parsed


class WalletViewSet(viewsets.ModelViewSet):
    queryset = Wallet.objects.all()
    serializer_class = WalletSerializer
    permission_classes = [IsAuthenticated, WalletPermissions]

    def get_queryset(self):
        queryset = Wallet.objects.all()

        if self.request.query_params.get("active") in {"true", "1", "yes"}:
            queryset = queryset.filter(is_active=True)

        return queryset

    @action(detail=False, methods=["get"], url_path="current")
    def current(self, request):
        serializer = self.get_serializer(Wallet.default())
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="analytics")
    def analytics(self, request):
        date_from = _date_param(request, "from_date")
        date_to = _date_param(request, "to_date")

        if date_from and date_to and date_from > date_to:
            date_from, date_to = date_to, date_from

        return Response(
            wallet_analytics(
                date_from=date_from,
                date_to=date_to,
                can_view_balance=can_view_wallet_balance(request.user),
            )
        )

    def perform_create(self, serializer):
        with transaction.atomic():
            is_default = serializer.validated_data.get("is_default")

            if is_default or not Wallet.objects.filter(is_default=True).exists():
                Wallet.objects.filter(is_default=True).update(is_default=False)
                is_default = True

            if is_default:
                wallet = serializer.save(is_default=True)
            else:
                wallet = serializer.save()
            balance_before = Decimal("0.00")
            log_wallet_change(
                wallet=wallet,
                actor=self.request.user,
                action=WalletLog.Action.WALLET_CREATED,
                amount_delta=wallet.balance,
                balance_before=balance_before,
                balance_after=wallet.balance,
                related_object=wallet,
                description=f"Wallet created: {wallet.name}",
            )

    def perform_update(self, serializer):
        with transaction.atomic():
            wallet = Wallet.objects.select_for_update().get(pk=serializer.instance.pk)
            balance_before = wallet.balance

            if wallet.is_default and serializer.validated_data.get("is_default") is False:
                raise ValidationError("Default wallet cannot be unset.")

            if wallet.is_default and serializer.validated_data.get("is_active") is False:
                raise ValidationError("Основной кошелёк нельзя отключить.")

            if serializer.validated_data.get("is_default"):
                Wallet.objects.exclude(pk=wallet.pk).filter(is_default=True).update(
                    is_default=False,
                )

            updated_wallet = serializer.save()
            amount_delta = updated_wallet.balance - balance_before
            log_wallet_change(
                wallet=updated_wallet,
                actor=self.request.user,
                action=WalletLog.Action.WALLET_UPDATED,
                amount_delta=amount_delta,
                balance_before=balance_before,
                balance_after=updated_wallet.balance,
                related_object=updated_wallet,
                description=f"Wallet updated: {updated_wallet.name}",
            )

    def destroy(self, request, *args, **kwargs):
        wallet = self.get_object()

        if wallet.is_default:
            return Response(
                {"detail": "Default wallet cannot be deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if wallet_in_use(wallet):
            return Response(
                {
                    "detail": (
                        "По кошельку есть операции — удалить нельзя. "
                        "Отключите его, чтобы скрыть из выбора."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        self.perform_destroy(wallet)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def perform_destroy(self, instance):
        with transaction.atomic():
            wallet = Wallet.objects.select_for_update().get(pk=instance.pk)
            log_wallet_change(
                wallet=wallet,
                actor=self.request.user,
                action=WalletLog.Action.WALLET_DELETED,
                amount_delta=-wallet.balance,
                balance_before=wallet.balance,
                balance_after=Decimal("0.00"),
                related_object=wallet,
                description=f"Wallet deleted: {wallet.name}",
            )
            wallet.delete()


class WalletLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = WalletLog.objects.select_related("wallet", "actor")
    serializer_class = WalletLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = WalletLog.objects.select_related("wallet", "actor").order_by(
            "-created_at",
            "-id",
        )
        wallet = self.request.query_params.get("wallet")

        if wallet and wallet.isdigit():
            queryset = queryset.filter(wallet_id=int(wallet))

        return queryset


class WalletTransferViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = WalletTransferSerializer
    permission_classes = [IsAuthenticated, WalletTransferPermissions]

    def get_queryset(self):
        queryset = WalletTransfer.objects.select_related(
            "from_wallet",
            "to_wallet",
            "actor",
        ).order_by("-date", "-id")
        wallet = self.request.query_params.get("wallet")

        if wallet and wallet.isdigit():
            wallet_id = int(wallet)
            queryset = queryset.filter(
                Q(from_wallet_id=wallet_id) | Q(to_wallet_id=wallet_id)
            )

        return queryset

    def perform_create(self, serializer):
        data = serializer.validated_data

        try:
            serializer.instance = create_transfer(
                from_wallet=data["from_wallet"],
                to_wallet=data["to_wallet"],
                amount=data["amount"],
                date=data.get("date"),
                note=data.get("note", ""),
                actor=self.request.user,
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc

    def perform_destroy(self, instance):
        delete_transfer(instance, actor=self.request.user)
