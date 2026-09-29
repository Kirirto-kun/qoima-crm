from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


# Create your models here.
class Spending(models.Model):
    name = models.CharField(max_length=120)
    type = models.CharField(max_length=120)
    amount = models.DecimalField(decimal_places=2, max_digits=20)
    date_spend = models.DateField(default=timezone.localdate, db_index=True)
    note = models.TextField(blank=True, null=True)
    wallet = models.ForeignKey(
        "wallets.Wallet",
        blank=True,
        null=True,
        on_delete=models.PROTECT,
        related_name="spendings",
    )

    class Meta:
        ordering = ("-date_spend", "-id")

class MonthlyObligation(models.Model):
    name = models.CharField(max_length=120)
    type = models.CharField(
        max_length=120,
        db_index=True,
    )
    amount = models.DecimalField(decimal_places=2, max_digits=20)
    due_date = models.DateField(default=timezone.localdate, db_index=True)
    charge_day = models.PositiveSmallIntegerField(
        default=1,
        validators=[MinValueValidator(1), MaxValueValidator(31)],
        db_index=True,
    )
    is_active = models.BooleanField(default=True, db_index=True)
    note = models.TextField(blank=True, default="")
    last_charged_for = models.DateField(blank=True, null=True, db_index=True)
    excluded_for = models.DateField(blank=True, null=True, db_index=True)
    last_spending = models.ForeignKey(
        Spending,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="monthly_obligation_charges",
    )
    wallet = models.ForeignKey(
        "wallets.Wallet",
        blank=True,
        null=True,
        on_delete=models.PROTECT,
        related_name="monthly_obligations",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("due_date", "id")
