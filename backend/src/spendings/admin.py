from django.contrib import admin

from src.spendings.models import MonthlyObligation, Spending


@admin.register(Spending)
class SpendingAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "type", "amount", "wallet", "date_spend")
    list_filter = ("type", "wallet", "date_spend")
    search_fields = ("name", "type", "note")


@admin.register(MonthlyObligation)
class MonthlyObligationAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "type",
        "amount",
        "charge_day",
        "due_date",
        "excluded_for",
        "is_active",
    )
    list_filter = ("type", "is_active", "charge_day", "due_date", "excluded_for")
    search_fields = ("name", "type", "note")
