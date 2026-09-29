from django.utils.text import slugify
from rest_framework import serializers

from core.permissions import can_view_wallet_balance
from src.users.serializers import UserSerializer
from src.wallets.models import Wallet, WalletLog, WalletTransfer


class WalletSerializer(serializers.ModelSerializer):
    can_view_balance = serializers.SerializerMethodField()

    class Meta:
        model = Wallet
        fields = (
            "id",
            "name",
            "code",
            "balance",
            "can_view_balance",
            "is_default",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "can_view_balance", "created_at", "updated_at")
        extra_kwargs = {"code": {"required": False, "allow_blank": True}}

    def get_can_view_balance(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and can_view_wallet_balance(request.user))

    def validate_code(self, value):
        code = slugify(value or "", allow_unicode=True)[:32]

        if not code:
            return ""

        duplicates = Wallet.objects.filter(code=code)

        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)

        if duplicates.exists():
            raise serializers.ValidationError("Кошелёк с таким кодом уже есть.")

        return code

    def to_representation(self, instance):
        data = super().to_representation(instance)

        if not data["can_view_balance"]:
            data["balance"] = None

        return data


class WalletLogSerializer(serializers.ModelSerializer):
    actor_detail = UserSerializer(source="actor", read_only=True)
    wallet_name = serializers.CharField(source="wallet.name", read_only=True)
    can_view_balance = serializers.SerializerMethodField()

    class Meta:
        model = WalletLog
        fields = (
            "id",
            "wallet",
            "wallet_name",
            "actor",
            "actor_detail",
            "action",
            "amount_delta",
            "balance_before",
            "balance_after",
            "can_view_balance",
            "description",
            "related_object_type",
            "related_object_id",
            "created_at",
        )
        read_only_fields = fields

    def get_can_view_balance(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and can_view_wallet_balance(request.user))

    def to_representation(self, instance):
        data = super().to_representation(instance)

        if not data["can_view_balance"]:
            data["amount_delta"] = None
            data["balance_before"] = None
            data["balance_after"] = None

        return data


class WalletTransferSerializer(serializers.ModelSerializer):
    from_wallet_name = serializers.CharField(source="from_wallet.name", read_only=True)
    to_wallet_name = serializers.CharField(source="to_wallet.name", read_only=True)
    actor_detail = UserSerializer(source="actor", read_only=True)
    can_view_balance = serializers.SerializerMethodField()

    class Meta:
        model = WalletTransfer
        fields = (
            "id",
            "from_wallet",
            "from_wallet_name",
            "to_wallet",
            "to_wallet_name",
            "amount",
            "date",
            "note",
            "actor",
            "actor_detail",
            "can_view_balance",
            "created_at",
        )
        read_only_fields = ("id", "actor", "actor_detail", "can_view_balance", "created_at")
        extra_kwargs = {"note": {"required": False, "allow_blank": True}}

    def get_can_view_balance(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and can_view_wallet_balance(request.user))

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Сумма перевода должна быть больше нуля.")
        return value

    def validate(self, attrs):
        from_wallet = attrs.get("from_wallet")
        to_wallet = attrs.get("to_wallet")

        if from_wallet and to_wallet and from_wallet.pk == to_wallet.pk:
            raise serializers.ValidationError(
                {"to_wallet": "Выберите другой кошелёк для перевода."}
            )

        for field in ("from_wallet", "to_wallet"):
            wallet = attrs.get(field)
            if wallet and not wallet.is_active:
                raise serializers.ValidationError({field: "Кошелёк отключён."})

        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)

        if not data["can_view_balance"]:
            data["amount"] = None

        return data


class WalletSourceField(serializers.PrimaryKeyRelatedField):
    """Wallet a spending/income is paid from/into. Omitted → default wallet."""

    def __init__(self, **kwargs):
        kwargs.setdefault("queryset", Wallet.objects.all())
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)


def validate_wallet_source(serializer, wallet):
    """Only active wallets may receive new records; an existing record may
    keep pointing to a wallet that was switched off later."""
    if wallet is None or wallet.is_active:
        return wallet

    instance = getattr(serializer, "instance", None)

    if instance is not None and instance.wallet_id == wallet.pk:
        return wallet

    raise serializers.ValidationError("Кошелёк отключён — выберите другой.")
