from django.db import models
from django.utils import timezone


# Create your models here.
class Income(models.Model):
    name = models.CharField(max_length=120)
    type = models.CharField(max_length=120)
    amount = models.DecimalField(decimal_places=2, max_digits=20)
    date_earned = models.DateField(default=timezone.localdate, db_index=True)
    note = models.TextField(blank=True, null=True)
    wallet = models.ForeignKey(
        "wallets.Wallet",
        blank=True,
        null=True,
        on_delete=models.PROTECT,
        related_name="incomes",
    )

    class Meta:
        ordering = ("-date_earned", "-id")
