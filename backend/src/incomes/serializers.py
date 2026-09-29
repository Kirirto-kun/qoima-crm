from rest_framework import serializers

from src.incomes.models import Income
from src.wallets.serializers import WalletSourceField, validate_wallet_source


class IncomeSerializer(serializers.ModelSerializer):
    wallet = WalletSourceField()
    wallet_name = serializers.SerializerMethodField()

    class Meta:
        model = Income
        fields = (
            "id",
            "name",
            "type",
            "amount",
            "date_earned",
            "note",
            "wallet",
            "wallet_name",
        )

    def get_wallet_name(self, obj):
        return obj.wallet.name if obj.wallet_id else None

    def validate_wallet(self, value):
        return validate_wallet_source(self, value)
