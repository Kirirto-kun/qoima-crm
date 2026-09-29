from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.db.models.functions import TruncDate, TruncMonth
from django.utils import timezone

from src.wallets.models import Wallet, WalletLog, WalletTransfer

ZERO = Decimal("0.00")
_UNSET = object()


def actor_or_none(user):
    if user and getattr(user, "is_authenticated", False):
        return user

    return None


def default_wallet_for_update():
    wallet = Wallet.objects.select_for_update().filter(is_default=True).first()

    if wallet:
        return wallet

    return Wallet.objects.create(name="Company wallet", is_default=True)


def wallet_for_update(wallet=None):
    if wallet is None:
        return default_wallet_for_update()

    wallet_id = getattr(wallet, "pk", wallet)
    return Wallet.objects.select_for_update().get(pk=wallet_id)


def log_wallet_change(
    *,
    wallet,
    actor=None,
    action,
    amount_delta,
    balance_before,
    balance_after,
    related_object=None,
    description="",
):
    related_object_type = ""
    related_object_id = ""

    if related_object is not None:
        related_object_type = related_object._meta.label
        related_object_id = str(related_object.pk)

    return WalletLog.objects.create(
        wallet=wallet,
        actor=actor_or_none(actor),
        action=action,
        amount_delta=amount_delta,
        balance_before=balance_before,
        balance_after=balance_after,
        related_object_type=related_object_type,
        related_object_id=related_object_id,
        description=description,
    )


@transaction.atomic
def apply_wallet_delta(
    amount_delta,
    *,
    wallet=None,
    actor=None,
    action,
    related_object=None,
    description="",
):
    wallet = wallet_for_update(wallet)
    delta = Decimal(amount_delta)
    balance_before = wallet.balance
    wallet.balance = balance_before + delta
    wallet.save(update_fields=("balance", "updated_at"))

    log = log_wallet_change(
        wallet=wallet,
        actor=actor,
        action=action,
        amount_delta=delta,
        balance_before=balance_before,
        balance_after=wallet.balance,
        related_object=related_object,
        description=description,
    )

    return wallet, log


def apply_default_wallet_delta(amount_delta, **kwargs):
    return apply_wallet_delta(amount_delta, wallet=None, **kwargs)


def ensure_record_wallet(record):
    """Records created without an explicit source land in the default wallet."""
    if record.wallet_id is None:
        record.wallet = default_wallet_for_update()
        record.save(update_fields=("wallet",))

    return record.wallet_id


def _default_wallet_id():
    return Wallet.default().pk


def _move_record(
    record,
    *,
    sign,
    old_amount,
    old_wallet_id,
    actor,
    action,
    description,
):
    """Re-apply an edited record: same wallet → apply the difference,
    different wallet → refund the old wallet and charge the new one."""
    new_wallet_id = ensure_record_wallet(record)

    if old_wallet_id is _UNSET:
        old_wallet_id = new_wallet_id
    elif old_wallet_id is None:
        old_wallet_id = _default_wallet_id()

    if old_wallet_id == new_wallet_id:
        return apply_wallet_delta(
            sign * (record.amount - old_amount),
            wallet=new_wallet_id,
            actor=actor,
            action=action,
            related_object=record,
            description=description,
        )

    old_wallet = Wallet.objects.get(pk=old_wallet_id)
    new_wallet = Wallet.objects.get(pk=new_wallet_id)
    apply_wallet_delta(
        -sign * old_amount,
        wallet=old_wallet_id,
        actor=actor,
        action=action,
        related_object=record,
        description=f"{description} (перенесено в «{new_wallet.name}»)",
    )
    return apply_wallet_delta(
        sign * record.amount,
        wallet=new_wallet_id,
        actor=actor,
        action=action,
        related_object=record,
        description=f"{description} (перенесено из «{old_wallet.name}»)",
    )


@transaction.atomic
def record_income_created(income, *, actor=None, description=""):
    wallet_id = ensure_record_wallet(income)
    return apply_wallet_delta(
        income.amount,
        wallet=wallet_id,
        actor=actor,
        action=WalletLog.Action.INCOME_CREATED,
        related_object=income,
        description=description or f"Income created: {income.name}",
    )


@transaction.atomic
def record_income_updated(
    income,
    *,
    old_amount,
    old_wallet_id=_UNSET,
    actor=None,
    description="",
):
    return _move_record(
        income,
        sign=1,
        old_amount=old_amount,
        old_wallet_id=old_wallet_id,
        actor=actor,
        action=WalletLog.Action.INCOME_UPDATED,
        description=description or f"Income updated: {income.name}",
    )


@transaction.atomic
def record_income_deleted(income, *, actor=None, description=""):
    return apply_wallet_delta(
        -income.amount,
        wallet=income.wallet_id,
        actor=actor,
        action=WalletLog.Action.INCOME_DELETED,
        related_object=income,
        description=description or f"Income deleted: {income.name}",
    )


@transaction.atomic
def record_spending_created(spending, *, actor=None, description=""):
    wallet_id = ensure_record_wallet(spending)
    return apply_wallet_delta(
        -spending.amount,
        wallet=wallet_id,
        actor=actor,
        action=WalletLog.Action.SPENDING_CREATED,
        related_object=spending,
        description=description or f"Spending created: {spending.name}",
    )


@transaction.atomic
def record_spending_updated(
    spending,
    *,
    old_amount,
    old_wallet_id=_UNSET,
    actor=None,
    description="",
):
    return _move_record(
        spending,
        sign=-1,
        old_amount=old_amount,
        old_wallet_id=old_wallet_id,
        actor=actor,
        action=WalletLog.Action.SPENDING_UPDATED,
        description=description or f"Spending updated: {spending.name}",
    )


@transaction.atomic
def record_spending_deleted(spending, *, actor=None, description=""):
    return apply_wallet_delta(
        spending.amount,
        wallet=spending.wallet_id,
        actor=actor,
        action=WalletLog.Action.SPENDING_DELETED,
        related_object=spending,
        description=description or f"Spending deleted: {spending.name}",
    )


def _lock_wallets(*wallet_ids):
    # Lock in a stable order so concurrent transfers cannot deadlock.
    locked = Wallet.objects.select_for_update().filter(pk__in=wallet_ids).order_by("pk")
    return {wallet.pk: wallet for wallet in locked}


@transaction.atomic
def create_transfer(
    *,
    from_wallet,
    to_wallet,
    amount,
    date=None,
    note="",
    actor=None,
):
    amount = Decimal(amount)

    if from_wallet.pk == to_wallet.pk:
        raise ValueError("Нельзя перевести деньги в тот же кошелёк.")

    if amount <= 0:
        raise ValueError("Сумма перевода должна быть больше нуля.")

    _lock_wallets(from_wallet.pk, to_wallet.pk)
    transfer = WalletTransfer.objects.create(
        from_wallet=from_wallet,
        to_wallet=to_wallet,
        amount=amount,
        date=date or timezone.localdate(),
        note=note or "",
        actor=actor_or_none(actor),
    )
    suffix = f": {note}" if note else ""
    apply_wallet_delta(
        -amount,
        wallet=from_wallet.pk,
        actor=actor,
        action=WalletLog.Action.TRANSFER_OUT,
        related_object=transfer,
        description=f"Перевод в «{to_wallet.name}»{suffix}",
    )
    apply_wallet_delta(
        amount,
        wallet=to_wallet.pk,
        actor=actor,
        action=WalletLog.Action.TRANSFER_IN,
        related_object=transfer,
        description=f"Перевод из «{from_wallet.name}»{suffix}",
    )
    return transfer


@transaction.atomic
def delete_transfer(transfer, *, actor=None):
    _lock_wallets(transfer.from_wallet_id, transfer.to_wallet_id)
    apply_wallet_delta(
        transfer.amount,
        wallet=transfer.from_wallet_id,
        actor=actor,
        action=WalletLog.Action.TRANSFER_DELETED,
        related_object=transfer,
        description=f"Перевод отменён: возврат из «{transfer.to_wallet.name}»",
    )
    apply_wallet_delta(
        -transfer.amount,
        wallet=transfer.to_wallet_id,
        actor=actor,
        action=WalletLog.Action.TRANSFER_DELETED,
        related_object=transfer,
        description=f"Перевод отменён: возврат в «{transfer.from_wallet.name}»",
    )
    transfer.delete()


def wallet_in_use(wallet) -> bool:
    return (
        wallet.spendings.exists()
        or wallet.incomes.exists()
        or wallet.monthly_obligations.exists()
        or wallet.outgoing_transfers.exists()
        or wallet.incoming_transfers.exists()
    )


def _money(value) -> str:
    return str(Decimal(value or ZERO).quantize(Decimal("0.01")))


def _rows_by_wallet(queryset, default_id):
    """{wallet_id: {total, count}} with legacy NULL wallets counted as default."""
    result = {}

    for row in queryset.values("wallet_id").annotate(total=Sum("amount"), count=Count("id")):
        wallet_id = row["wallet_id"] or default_id
        bucket = result.setdefault(wallet_id, {"total": ZERO, "count": 0})
        bucket["total"] += row["total"] or ZERO
        bucket["count"] += row["count"]

    return result


def _types_by_wallet(queryset, default_id, limit=6):
    result = {}
    rows = (
        queryset.values("wallet_id", "type")
        .annotate(total=Sum("amount"), count=Count("id"))
        .order_by("-total")
    )

    for row in rows:
        wallet_id = row["wallet_id"] or default_id
        items = result.setdefault(wallet_id, [])

        if len(items) < limit:
            items.append(
                {
                    "type": row["type"],
                    "total_amount": _money(row["total"]),
                    "count": row["count"],
                }
            )

    return result


def _bucket_start(value: date, group_by: str) -> date:
    if isinstance(value, datetime):
        value = value.date()

    if group_by == "month":
        return date(value.year, value.month, 1)

    return value


def _next_bucket(value: date, group_by: str) -> date:
    if group_by == "month":
        if value.month == 12:
            return date(value.year + 1, 1, 1)
        return date(value.year, value.month + 1, 1)

    return value + timedelta(days=1)


def _timeline(incomes, spendings, wallet_ids, default_id, date_from, date_to):
    if not date_from or not date_to:
        return "day", []

    group_by = "month" if (date_to - date_from).days > 62 else "day"
    trunc = TruncMonth if group_by == "month" else TruncDate
    buckets = {}
    current = _bucket_start(date_from, group_by)
    end = _bucket_start(date_to, group_by)

    while current <= end:
        buckets[current] = {
            "income": {str(wallet_id): ZERO for wallet_id in wallet_ids},
            "spending": {str(wallet_id): ZERO for wallet_id in wallet_ids},
        }
        current = _next_bucket(current, group_by)

    for key, queryset, field in (
        ("income", incomes, "date_earned"),
        ("spending", spendings, "date_spend"),
    ):
        rows = (
            queryset.annotate(bucket=trunc(field))
            .values("bucket", "wallet_id")
            .annotate(total=Sum("amount"))
        )

        for row in rows:
            bucket = buckets.get(_bucket_start(row["bucket"], group_by))
            wallet_key = str(row["wallet_id"] or default_id)

            if bucket is None or wallet_key not in bucket[key]:
                continue

            bucket[key][wallet_key] += row["total"] or ZERO

    return group_by, [
        {
            "date": bucket_date,
            "income": {k: _money(v) for k, v in values["income"].items()},
            "spending": {k: _money(v) for k, v in values["spending"].items()},
        }
        for bucket_date, values in buckets.items()
    ]


def wallet_analytics(*, date_from=None, date_to=None, can_view_balance=True):
    from src.incomes.models import Income
    from src.spendings.models import Spending

    default_id = Wallet.default().pk
    wallets = list(Wallet.objects.all())
    incomes = Income.objects.all()
    spendings = Spending.objects.all()
    transfers = WalletTransfer.objects.all()

    if date_from:
        incomes = incomes.filter(date_earned__gte=date_from)
        spendings = spendings.filter(date_spend__gte=date_from)
        transfers = transfers.filter(date__gte=date_from)

    if date_to:
        incomes = incomes.filter(date_earned__lte=date_to)
        spendings = spendings.filter(date_spend__lte=date_to)
        transfers = transfers.filter(date__lte=date_to)

    income_rows = _rows_by_wallet(incomes, default_id)
    spending_rows = _rows_by_wallet(spendings, default_id)
    spending_types = _types_by_wallet(spendings, default_id)
    income_types = _types_by_wallet(incomes, default_id)
    transfer_out = {
        row["from_wallet_id"]: row["total"] or ZERO
        for row in transfers.values("from_wallet_id").annotate(total=Sum("amount"))
    }
    transfer_in = {
        row["to_wallet_id"]: row["total"] or ZERO
        for row in transfers.values("to_wallet_id").annotate(total=Sum("amount"))
    }

    if not date_from:
        known = [
            value
            for value in (
                incomes.order_by("date_earned").values_list("date_earned", flat=True).first(),
                spendings.order_by("date_spend").values_list("date_spend", flat=True).first(),
            )
            if value
        ]
        timeline_from = min(known) if known else None
    else:
        timeline_from = date_from

    timeline_to = date_to or timezone.localdate()
    group_by, timeline = _timeline(
        incomes,
        spendings,
        [wallet.pk for wallet in wallets],
        default_id,
        timeline_from,
        timeline_to,
    )

    rows = []
    totals = {
        "balance": ZERO,
        "income_total": ZERO,
        "income_count": 0,
        "spending_total": ZERO,
        "spending_count": 0,
        "transfer_total": sum(transfer_out.values(), ZERO),
    }

    for wallet in wallets:
        income = income_rows.get(wallet.pk, {"total": ZERO, "count": 0})
        spending = spending_rows.get(wallet.pk, {"total": ZERO, "count": 0})
        t_in = transfer_in.get(wallet.pk, ZERO)
        t_out = transfer_out.get(wallet.pk, ZERO)
        if wallet.is_active:
            totals["balance"] += wallet.balance
        totals["income_total"] += income["total"]
        totals["income_count"] += income["count"]
        totals["spending_total"] += spending["total"]
        totals["spending_count"] += spending["count"]
        rows.append(
            {
                "id": wallet.pk,
                "name": wallet.name,
                "code": wallet.code,
                "is_default": wallet.is_default,
                "is_active": wallet.is_active,
                "balance": _money(wallet.balance),
                "income_total": _money(income["total"]),
                "income_count": income["count"],
                "spending_total": _money(spending["total"]),
                "spending_count": spending["count"],
                "transfer_in": _money(t_in),
                "transfer_out": _money(t_out),
                "net": _money(income["total"] - spending["total"] + t_in - t_out),
                "spending_by_type": spending_types.get(wallet.pk, []),
                "income_by_type": income_types.get(wallet.pk, []),
            }
        )

    result = {
        "date_from": date_from,
        "date_to": date_to,
        "group_by": group_by,
        "can_view_balance": can_view_balance,
        "totals": {
            **totals,
            "balance": _money(totals["balance"]),
            "income_total": _money(totals["income_total"]),
            "spending_total": _money(totals["spending_total"]),
            "transfer_total": _money(totals["transfer_total"]),
            "net": _money(totals["income_total"] - totals["spending_total"]),
        },
        "wallets": rows,
        "timeline": timeline,
    }

    if not can_view_balance:
        _mask_analytics(result)

    return result


_MONEY_KEYS = {
    "balance",
    "income_total",
    "spending_total",
    "transfer_in",
    "transfer_out",
    "transfer_total",
    "net",
    "total_amount",
}


def _mask_analytics(data):
    if isinstance(data, dict):
        for key, value in data.items():
            if key in _MONEY_KEYS:
                data[key] = None
            elif key in {"income", "spending"} and isinstance(value, dict):
                data[key] = {wallet_key: None for wallet_key in value}
            else:
                _mask_analytics(value)
    elif isinstance(data, list):
        for item in data:
            _mask_analytics(item)
