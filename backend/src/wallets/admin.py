from django.contrib import admin

from src.wallets.models import Wallet, WalletLog, WalletTransfer


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "code", "balance", "is_default", "is_active", "updated_at")
    list_filter = ("is_default", "is_active")
    search_fields = ("name", "code")


@admin.register(WalletLog)
class WalletLogAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "wallet",
        "actor",
        "action",
        "amount_delta",
        "balance_before",
        "balance_after",
        "created_at",
    )
    list_filter = ("action", "created_at")
    search_fields = ("description", "related_object_type", "related_object_id")


@admin.register(WalletTransfer)
class WalletTransferAdmin(admin.ModelAdmin):
    list_display = ("id", "from_wallet", "to_wallet", "amount", "date", "actor", "created_at")
    list_filter = ("from_wallet", "to_wallet", "date")
    search_fields = ("note",)
