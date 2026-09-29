import re
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.text import slugify


def normalize_wallet_token(value: str) -> str:
    """Lowercase and drop separators so `Company wallet`, `company_wallet`
    and `company-wallet` all compare equal (used by Telegram lookups)."""
    return re.sub(r"[\s_\-.]+", "", (value or "").strip().lower().lstrip("#@"))


class Wallet(models.Model):
    name = models.CharField(max_length=120)
    code = models.CharField(
        max_length=32,
        blank=True,
        default="",
        help_text="Short alias used in Telegram commands, e.g. cash or kaspi.",
    )
    balance = models.DecimalField(
        decimal_places=2,
        default=Decimal("0.00"),
        max_digits=20,
    )
    is_default = models.BooleanField(default=False, db_index=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-is_default", "name")
        constraints = [
            models.UniqueConstraint(
                fields=("is_default",),
                condition=Q(is_default=True),
                name="wallets_single_default_wallet",
            ),
            models.UniqueConstraint(
                fields=("code",),
                condition=~Q(code=""),
                name="wallets_unique_code",
            ),
        ]

    def __str__(self):
        return f"{self.name}: {self.balance}"

    def save(self, *args, **kwargs):
        self.code = slugify(self.code or "", allow_unicode=True)[:32]

        if not self.code:
            self.code = self.generate_code(self.name, exclude_pk=self.pk)

        super().save(*args, **kwargs)

    @classmethod
    def generate_code(cls, name: str, *, exclude_pk=None) -> str:
        base = slugify(name or "", allow_unicode=True)[:28] or "wallet"
        code = base
        suffix = 2
        existing = cls.objects.all()

        if exclude_pk is not None:
            existing = existing.exclude(pk=exclude_pk)

        while existing.filter(code=code).exists():
            code = f"{base}-{suffix}"
            suffix += 1

        return code

    @classmethod
    def default(cls):
        wallet = cls.objects.filter(is_default=True).first()

        if wallet:
            return wallet

        return cls.objects.create(name="Company wallet", is_default=True)

    @classmethod
    def find_by_token(cls, token: str, queryset=None):
        """Resolve a Telegram token (code or name) to an active wallet."""
        normalized = normalize_wallet_token(token)

        if not normalized:
            return None

        queryset = queryset if queryset is not None else cls.objects.filter(is_active=True)

        for wallet in queryset:
            if normalized in {
                normalize_wallet_token(wallet.code),
                normalize_wallet_token(wallet.name),
            }:
                return wallet

        return None


class WalletTransfer(models.Model):
    from_wallet = models.ForeignKey(
        Wallet,
        on_delete=models.PROTECT,
        related_name="outgoing_transfers",
    )
    to_wallet = models.ForeignKey(
        Wallet,
        on_delete=models.PROTECT,
        related_name="incoming_transfers",
    )
    amount = models.DecimalField(decimal_places=2, max_digits=20)
    date = models.DateField(default=timezone.localdate, db_index=True)
    note = models.TextField(blank=True, default="")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="wallet_transfers",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-date", "-id")

    def __str__(self):
        return f"{self.from_wallet_id} -> {self.to_wallet_id}: {self.amount}"


class WalletLog(models.Model):
    class Action(models.TextChoices):
        WALLET_CREATED = "wallet_created", "Wallet created"
        WALLET_UPDATED = "wallet_updated", "Wallet updated"
        WALLET_DELETED = "wallet_deleted", "Wallet deleted"
        WALLET_INITIALIZED = "wallet_initialized", "Wallet initialized"
        INCOME_CREATED = "income_created", "Income created"
        INCOME_UPDATED = "income_updated", "Income updated"
        INCOME_DELETED = "income_deleted", "Income deleted"
        SPENDING_CREATED = "spending_created", "Spending created"
        SPENDING_UPDATED = "spending_updated", "Spending updated"
        SPENDING_DELETED = "spending_deleted", "Spending deleted"
        TRANSFER_OUT = "transfer_out", "Transfer out"
        TRANSFER_IN = "transfer_in", "Transfer in"
        TRANSFER_DELETED = "transfer_deleted", "Transfer deleted"

    wallet = models.ForeignKey(
        Wallet,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="logs",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="wallet_logs",
    )
    action = models.CharField(max_length=40, choices=Action.choices)
    amount_delta = models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=20)
    balance_before = models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=20)
    balance_after = models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=20)
    description = models.TextField(blank=True)
    related_object_type = models.CharField(max_length=120, blank=True)
    related_object_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self):
        return f"{self.action}: {self.amount_delta}"
