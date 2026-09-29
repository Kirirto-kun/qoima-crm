import calendar
from datetime import date

from django.utils import timezone
from rest_framework import serializers

from src.spendings.models import MonthlyObligation, Spending
from src.wallets.serializers import WalletSourceField, validate_wallet_source


def next_due_date_for_day(charge_day: int, today=None) -> date:
    today = today or timezone.localdate()
    day = min(charge_day, calendar.monthrange(today.year, today.month)[1])
    candidate = date(today.year, today.month, day)

    if candidate >= today:
        return candidate

    year = today.year + int(today.month == 12)
    month = 1 if today.month == 12 else today.month + 1
    day = min(charge_day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


class SpendingSerializer(serializers.ModelSerializer):
    wallet = WalletSourceField()
    wallet_name = serializers.SerializerMethodField()

    class Meta:
        model = Spending
        fields = (
            "id",
            "name",
            "type",
            "amount",
            "date_spend",
            "note",
            "wallet",
            "wallet_name",
        )

    def get_wallet_name(self, obj):
        return obj.wallet.name if obj.wallet_id else None

    def validate_wallet(self, value):
        return validate_wallet_source(self, value)


class MonthlyObligationSerializer(serializers.ModelSerializer):
    is_excluded_current_month = serializers.SerializerMethodField()
    wallet = WalletSourceField()
    wallet_name = serializers.SerializerMethodField()

    class Meta:
        model = MonthlyObligation
        fields = (
            "id",
            "name",
            "type",
            "amount",
            "due_date",
            "charge_day",
            "is_active",
            "note",
            "last_charged_for",
            "excluded_for",
            "is_excluded_current_month",
            "last_spending",
            "wallet",
            "wallet_name",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "last_charged_for",
            "excluded_for",
            "is_excluded_current_month",
            "last_spending",
            "created_at",
            "updated_at",
        )

    def get_wallet_name(self, obj):
        return obj.wallet.name if obj.wallet_id else None

    def validate_wallet(self, value):
        return validate_wallet_source(self, value)

    def get_is_excluded_current_month(self, obj) -> bool:
        today = timezone.localdate()
        current_month = today.replace(day=1)
        return obj.excluded_for == current_month

    def validate_type(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Type is required.")
        return value

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value

    def validate(self, attrs):
        initial_data = getattr(self, "initial_data", {}) or {}
        charge_day_provided = "charge_day" in initial_data
        due_date_provided = "due_date" in initial_data
        due_date = attrs.get("due_date")

        if due_date_provided and due_date and not charge_day_provided:
            attrs["charge_day"] = due_date.day

        if charge_day_provided and not due_date_provided:
            attrs["due_date"] = next_due_date_for_day(attrs["charge_day"])

        if self.instance is None and not due_date_provided and not charge_day_provided:
            today = timezone.localdate()
            attrs["charge_day"] = today.day
            attrs["due_date"] = today

        return attrs
