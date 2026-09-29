import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from src.spendings.models import MonthlyObligation, Spending
from src.telegram_bot.models import TelegramBotConfig, TelegramChat
from src.telegram_bot.services.telegram import TelegramClient
from src.wallets.services import record_spending_created, record_spending_deleted


@dataclass(frozen=True)
class MonthlyObligationCharge:
    obligation_id: int
    obligation_name: str
    spending_id: int
    spending_date: date
    amount: Decimal
    type: str
    wallet_balance: Decimal
    wallet_name: str = ""


def next_due_date_for_day(charge_day: int, today=None) -> date:
    today = today or timezone.localdate()
    day = min(charge_day, calendar.monthrange(today.year, today.month)[1])
    candidate = date(today.year, today.month, day)

    if candidate >= today:
        return candidate

    return scheduled_date_for_month(today.year, today.month + 1, charge_day)


def scheduled_date_for_month(year: int, month: int, charge_day: int) -> date:
    while month > 12:
        year += 1
        month -= 12

    while month < 1:
        year -= 1
        month += 12

    day = min(charge_day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def next_month_due_date(current_due_date: date, charge_day: int) -> date:
    return scheduled_date_for_month(
        current_due_date.year,
        current_due_date.month + 1,
        charge_day,
    )


def charge_due_monthly_obligations(*, today=None, notify=True, dry_run=False):
    today = today or timezone.localdate()
    obligation_ids = list(
        MonthlyObligation.objects.filter(is_active=True, due_date__lte=today)
        .order_by("due_date", "id")
        .values_list("id", flat=True)
    )
    charges = []

    if dry_run:
        preview = MonthlyObligation.objects.filter(id__in=obligation_ids).order_by(
            "due_date",
            "id",
        )
        for obligation in preview:
            charges.extend(_preview_obligation_charges(obligation, today))
        return _result(today=today, charges=charges, telegram={"sent": False})

    for obligation_id in obligation_ids:
        charges.extend(_charge_obligation(obligation_id, today))

    telegram = {"sent": False}
    if notify and charges:
        telegram = send_monthly_obligation_notification(charges, today=today)

    return _result(today=today, charges=charges, telegram=telegram)


def exclude_monthly_obligation_current_month(
    obligation_id: int,
    *,
    actor=None,
    today=None,
):
    today = today or timezone.localdate()
    current_month = today.replace(day=1)

    with transaction.atomic():
        obligation = MonthlyObligation.objects.select_for_update().get(pk=obligation_id)
        obligation.excluded_for = current_month
        removed_spending_id = None
        wallet_balance = None

        if (
            obligation.last_charged_for == current_month
            and obligation.last_spending_id
        ):
            spending = (
                Spending.objects.select_for_update()
                .filter(pk=obligation.last_spending_id)
                .first()
            )

            if spending and spending.date_spend.replace(day=1) == current_month:
                obligation.last_spending = None
                removed_spending_id = spending.id
                wallet, _ = record_spending_deleted(
                    spending,
                    actor=actor,
                    description=f"Monthly obligation excluded: {obligation.name}",
                )
                wallet_balance = wallet.balance
                spending.delete()

        obligation.save(
            update_fields=(
                "excluded_for",
                "last_spending",
                "updated_at",
            )
        )

    return {
        "excluded_for": current_month,
        "removed_spending_id": removed_spending_id,
        "wallet_balance": wallet_balance,
    }


def clear_monthly_obligation_current_month_exclusion(obligation_id: int, *, today=None):
    today = today or timezone.localdate()
    current_month = today.replace(day=1)

    with transaction.atomic():
        obligation = MonthlyObligation.objects.select_for_update().get(pk=obligation_id)

        if obligation.excluded_for == current_month:
            obligation.excluded_for = None
            obligation.save(update_fields=("excluded_for", "updated_at"))

    return {"excluded_for": obligation.excluded_for}


def _charge_obligation(obligation_id: int, today: date):
    charges = []

    with transaction.atomic():
        obligation = MonthlyObligation.objects.select_for_update().get(pk=obligation_id)

        while obligation.is_active and obligation.due_date <= today:
            charged_for = obligation.due_date.replace(day=1)

            if obligation.excluded_for == charged_for:
                obligation.last_charged_for = charged_for
            elif obligation.last_charged_for != charged_for:
                spending = Spending.objects.create(
                    name=obligation.name,
                    type=obligation.type,
                    amount=obligation.amount,
                    date_spend=obligation.due_date,
                    note=_spending_note(obligation),
                    wallet=obligation.wallet,
                )
                wallet, _ = record_spending_created(
                    spending,
                    description=f"Monthly obligation charged: {obligation.name}",
                )
                obligation.last_charged_for = charged_for
                obligation.last_spending = spending
                charges.append(
                    MonthlyObligationCharge(
                        obligation_id=obligation.id,
                        obligation_name=obligation.name,
                        spending_id=spending.id,
                        spending_date=spending.date_spend,
                        amount=spending.amount,
                        type=spending.type,
                        wallet_balance=wallet.balance,
                        wallet_name=wallet.name,
                    )
                )

            obligation.due_date = next_month_due_date(
                obligation.due_date,
                obligation.charge_day,
            )

        obligation.save(
            update_fields=(
                "due_date",
                "last_charged_for",
                "excluded_for",
                "last_spending",
                "updated_at",
            )
        )

    return charges


def _preview_obligation_charges(obligation, today: date):
    charges = []
    due_date = obligation.due_date
    last_charged_for = obligation.last_charged_for

    while due_date <= today:
        charged_for = due_date.replace(day=1)

        if obligation.excluded_for == charged_for:
            last_charged_for = charged_for
        elif last_charged_for != charged_for:
            charges.append(
                MonthlyObligationCharge(
                    obligation_id=obligation.id,
                    obligation_name=obligation.name,
                    spending_id=0,
                    spending_date=due_date,
                    amount=obligation.amount,
                    type=obligation.type,
                    wallet_balance=Decimal("0.00"),
                )
            )
            last_charged_for = charged_for

        due_date = next_month_due_date(due_date, obligation.charge_day)

    return charges


def _spending_note(obligation: MonthlyObligation) -> str:
    note = f"Автоматическое ежемесячное списание: {obligation.name}"

    if obligation.note:
        note = f"{note}\n{obligation.note}"

    return note


def send_monthly_obligation_notification(charges, *, today: date):
    chat_id = _notification_chat_id()

    if not chat_id:
        return {"sent": False, "chat_id": None, "reason": "telegram chat is not configured"}

    total = sum((charge.amount for charge in charges), Decimal("0.00"))
    lines = [
        "Списаны ежемесячные обязательные расходы",
        f"Дата: {today.isoformat()}",
        f"Всего: {_money(total)} ₸",
        "",
    ]

    for charge in charges[:10]:
        wallet = f" · {charge.wallet_name}" if charge.wallet_name else ""
        lines.append(
            f"- {charge.obligation_name}: {_money(charge.amount)} ₸ "
            f"({charge.spending_date.isoformat()}){wallet}"
        )

    if len(charges) > 10:
        lines.append(f"...и еще {len(charges) - 10}")

    # Last known balance of every wallet that was charged.
    balances = {}
    for charge in charges:
        balances[charge.wallet_name or "Кошелёк"] = charge.wallet_balance

    lines.append("")
    for wallet_name, balance in balances.items():
        lines.append(f"Баланс «{wallet_name}»: {_money(balance)} ₸")

    sent = TelegramClient().send_message(chat_id, "\n".join(lines))
    return {"sent": sent, "chat_id": chat_id}


def _notification_chat_id():
    config = TelegramBotConfig.active()

    if config:
        configured_chat_id = config.settings.get("monthly_obligation_chat_id")
        if configured_chat_id:
            try:
                return int(configured_chat_id)
            except (TypeError, ValueError):
                pass

        if config.task_approval_chat and config.task_approval_chat.is_active:
            return config.task_approval_chat.chat_id

    chat = TelegramChat.objects.filter(is_active=True).order_by("-updated_at").first()
    return chat.chat_id if chat else None


def _money(amount) -> str:
    value = Decimal(amount).quantize(Decimal("1"))
    return f"{value:,}".replace(",", " ")


def _result(*, today: date, charges, telegram):
    total = sum((charge.amount for charge in charges), Decimal("0.00"))
    return {
        "date": today,
        "created_count": len(charges),
        "total_amount": total,
        "charges": [
            {
                "obligation_id": charge.obligation_id,
                "obligation_name": charge.obligation_name,
                "spending_id": charge.spending_id,
                "spending_date": charge.spending_date,
                "amount": charge.amount,
                "type": charge.type,
                "wallet_balance": charge.wallet_balance,
                "wallet_name": charge.wallet_name,
            }
            for charge in charges
        ],
        "telegram": telegram,
    }
