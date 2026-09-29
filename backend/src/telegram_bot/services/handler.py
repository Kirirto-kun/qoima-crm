from dataclasses import replace
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.utils import timezone
from src.incomes.models import Income
from src.spendings.models import Spending
from src.telegram_bot.models import (
    TelegramChat,
    TelegramCommandLog,
)
from src.telegram_bot.services.parser import CommandParseError, CommandParser
from src.telegram_bot.services.reports import ReportBuilder
from src.telegram_bot.services.task_approval import TelegramTaskApprovalService
from src.telegram_bot.services.telegram import TelegramClient
from src.wallets.models import Wallet, WalletLog
from src.wallets.services import (
    create_transfer,
    record_income_created,
    record_spending_created,
    wallet_analytics,
)

MONTHS_RU = (
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
)


class TelegramBotService:
    WALLET_PICK_PREFIX = "wpick"
    WALLET_PICK_CANCEL = "x"

    def __init__(self):
        self.parser = CommandParser()
        self.reports = ReportBuilder()
        self.client = TelegramClient()

    def handle_update(self, update: dict) -> dict:
        update_id = update.get("update_id")
        existing = self._existing_log(update_id)

        if existing:
            return {"duplicate": True, "response": existing.response}

        if update.get("callback_query"):
            return self._handle_callback_query(update_id, update["callback_query"])

        message = update.get("message") or update.get("edited_message") or {}
        text = message.get("text", "")
        chat_data = message.get("chat") or {}
        from_data = message.get("from") or {}

        if not text:
            return self._log_ignored(update_id, chat_data, from_data)

        chat = self._upsert_chat(chat_data)
        user = self._user(from_data)
        command_name = ""
        created_object = None
        pending_wallets = []

        try:
            command = self.parser.parse(text)
            command_name = command.name

            if command.name == "help":
                response = self._help_text()
                status = TelegramCommandLog.Status.SUCCESS
            elif command.name == "whoami":
                response = self._whoami_text(from_data, user)
                status = TelegramCommandLog.Status.SUCCESS
            elif not user:
                response = self._not_linked_text(from_data)
                status = TelegramCommandLog.Status.DENIED
            elif command.name == "report":
                self._require_accounting(user, "accounting_can_retrieve")
                response = self.reports.build(command)
                status = TelegramCommandLog.Status.SUCCESS
            elif command.name == "wallet":
                response = self._wallet_text(command.wallet_token)
                status = TelegramCommandLog.Status.SUCCESS
            elif command.name in {"income", "spending"}:
                self._require_accounting(user, "accounting_can_create")
                wallet, command = self._with_wallet(command)

                if wallet is None:
                    pending_wallets = self._active_wallets()

                    if len(pending_wallets) == 1:
                        wallet = pending_wallets[0]

                if wallet is None:
                    response = self._pick_wallet_text(command)
                    status = TelegramCommandLog.Status.PENDING
                else:
                    created_object = self._create_money_record(command, user, wallet, text)
                    response = self._created_text(command, wallet)
                    status = TelegramCommandLog.Status.SUCCESS
            elif command.name == "transfer":
                self._require_accounting(user, "wallets_can_update")
                created_object = self._create_transfer(command, user)
                response = self._transfer_text(created_object)
                status = TelegramCommandLog.Status.SUCCESS
            else:
                response = self._help_text()
                status = TelegramCommandLog.Status.IGNORED
            error = ""
        except PermissionError as exc:
            response = str(exc)
            status = TelegramCommandLog.Status.DENIED
            error = str(exc)
        except CommandParseError as exc:
            response = f"{exc}\n\n{self._help_text()}"
            status = TelegramCommandLog.Status.FAILED
            error = str(exc)

        log = TelegramCommandLog.objects.create(
            update_id=update_id,
            chat=chat,
            user=user,
            telegram_user_id=from_data.get("id"),
            telegram_chat_id=chat_data.get("id"),
            command=command_name,
            text=text,
            status=status,
            response=response,
            error=error,
            created_object_type=created_object._meta.label if created_object else "",
            created_object_id=str(created_object.pk) if created_object else "",
        )

        if chat_data.get("id"):
            if status == TelegramCommandLog.Status.PENDING:
                self.client.send_message_with_result(
                    chat_data["id"],
                    response,
                    reply_markup=self._wallet_keyboard(log.id, pending_wallets),
                )
            else:
                self.client.send_message(chat_data["id"], response)

        return {"duplicate": False, "log_id": log.id, "status": status}

    def _handle_callback_query(self, update_id, callback_query: dict) -> dict:
        message = callback_query.get("message") or {}
        chat_data = message.get("chat") or {}
        from_data = callback_query.get("from") or {}
        data = callback_query.get("data", "")
        callback_id = callback_query.get("id")
        chat = self._upsert_chat(chat_data)
        user = self._user(from_data)
        command_name = "callback"
        response = ""
        status = TelegramCommandLog.Status.IGNORED
        error = ""
        created_object_type = ""
        created_object_id = ""

        try:
            if data.startswith(f"{TelegramTaskApprovalService.CALLBACK_PREFIX}:"):
                result = TelegramTaskApprovalService(self.client).handle_callback(
                    callback_query,
                    user,
                )
                command_name = "task_approval"
                response = result.response
                status = (
                    TelegramCommandLog.Status.SUCCESS
                    if result.status == "success"
                    else TelegramCommandLog.Status.IGNORED
                )
                created_object_type = "onboards.Task" if result.task_id else ""
                created_object_id = str(result.task_id) if result.task_id else ""
            elif data.startswith(f"{self.WALLET_PICK_PREFIX}:"):
                command_name = "wallet_pick"
                response, status, created_object = self._handle_wallet_pick(
                    data,
                    user,
                    message,
                )
                if created_object is not None:
                    created_object_type = created_object._meta.label
                    created_object_id = str(created_object.pk)
            else:
                response = "Неизвестное действие."
                error = response
        except PermissionError as exc:
            response = str(exc)
            status = TelegramCommandLog.Status.DENIED
            error = str(exc)
        except (ObjectDoesNotExist, ValueError) as exc:
            response = str(exc)
            status = TelegramCommandLog.Status.FAILED
            error = str(exc)

        if callback_id:
            self.client.answer_callback_query(
                callback_id,
                response,
                show_alert=status != TelegramCommandLog.Status.SUCCESS,
            )

        log = TelegramCommandLog.objects.create(
            update_id=update_id,
            chat=chat,
            user=user,
            telegram_user_id=from_data.get("id"),
            telegram_chat_id=chat_data.get("id"),
            command=command_name,
            text=data,
            status=status,
            response=response,
            error=error,
            created_object_type=created_object_type,
            created_object_id=created_object_id,
        )

        return {"duplicate": False, "log_id": log.id, "status": status}

    # ----- wallets -----

    def _handle_wallet_pick(self, data: str, user, message: dict):
        parts = data.split(":")

        if len(parts) != 3 or not parts[1].isdigit():
            raise ValueError("Некорректная кнопка.")

        log_id = int(parts[1])
        choice = parts[2]
        created_object = None

        with transaction.atomic():
            log = (
                TelegramCommandLog.objects.select_for_update()
                .filter(pk=log_id)
                .first()
            )

            if log is None:
                raise ValueError("Команда не найдена.")

            if log.status != TelegramCommandLog.Status.PENDING:
                return "Эта запись уже обработана.", TelegramCommandLog.Status.IGNORED, None

            if not user or log.user_id != user.id:
                raise PermissionError("Выбрать кошелёк может только автор команды.")

            if choice == self.WALLET_PICK_CANCEL:
                final_text = f"Отменено: {log.text}"
                answer = "Отменено."
                log.status = TelegramCommandLog.Status.IGNORED
                log.response = final_text
                log.save(update_fields=("status", "response"))
            else:
                if not choice.isdigit():
                    raise ValueError("Некорректная кнопка.")

                wallet = Wallet.objects.filter(pk=int(choice), is_active=True).first()

                if wallet is None:
                    raise ValueError("Кошелёк не найден или отключён.")

                self._require_accounting(user, "accounting_can_create")
                _, command = self._with_wallet(self.parser.parse(log.text))
                created_object = self._create_money_record(command, user, wallet, log.text)
                final_text = self._created_text(command, wallet)
                answer = f"Записано: {wallet.name}"
                log.status = TelegramCommandLog.Status.SUCCESS
                log.response = final_text
                log.created_object_type = created_object._meta.label
                log.created_object_id = str(created_object.pk)
                log.save(
                    update_fields=(
                        "status",
                        "response",
                        "created_object_type",
                        "created_object_id",
                    )
                )

        chat_id = (message.get("chat") or {}).get("id")
        message_id = message.get("message_id")

        if chat_id and message_id:
            self.client.edit_message_text(
                chat_id,
                message_id,
                final_text,
                reply_markup={"inline_keyboard": []},
            )

        return answer, TelegramCommandLog.Status.SUCCESS, created_object

    def _active_wallets(self) -> list[Wallet]:
        Wallet.default()
        return list(Wallet.objects.filter(is_active=True).order_by("-is_default", "name"))

    def _with_wallet(self, command):
        """Pull a wallet alias out of the label: first or last word may be a
        wallet code/name (`/spending 5000 cash taxi`, `/spending 5000 taxi cash`)."""
        parts = command.label.split()
        wallet = None

        if parts:
            candidates = self._active_wallets()
            wallet = Wallet.find_by_token(parts[0], candidates)

            if wallet is not None:
                parts = parts[1:]
            elif len(parts) > 1:
                wallet = Wallet.find_by_token(parts[-1], candidates)

                if wallet is not None:
                    parts = parts[:-1]

        label = " ".join(parts).strip() or "telegram"
        return wallet, replace(command, label=label)

    def _create_money_record(self, command, user, wallet, text):
        with transaction.atomic():
            if command.name == "income":
                record = Income.objects.create(
                    name=command.label,
                    type=command.label,
                    amount=command.amount,
                    date_earned=command.record_date,
                    note=f"Telegram: {text}",
                    wallet=wallet,
                )
                record_income_created(
                    record,
                    actor=user,
                    description=f"Telegram income: {command.label}",
                )
            else:
                record = Spending.objects.create(
                    name=command.label,
                    type=command.label,
                    amount=command.amount,
                    date_spend=command.record_date,
                    note=f"Telegram: {text}",
                    wallet=wallet,
                )
                record_spending_created(
                    record,
                    actor=user,
                    description=f"Telegram spending: {command.label}",
                )

        return record

    def _create_transfer(self, command, user):
        wallets = self._active_wallets()
        from_wallet = Wallet.find_by_token(command.wallet_token, wallets)
        to_wallet = Wallet.find_by_token(command.target_token, wallets)
        missing = [
            token
            for token, wallet in (
                (command.wallet_token, from_wallet),
                (command.target_token, to_wallet),
            )
            if wallet is None
        ]

        if missing:
            raise CommandParseError(
                f"Кошелёк не найден: {', '.join(missing)}.\n{self._wallet_codes_text()}"
            )

        try:
            return create_transfer(
                from_wallet=from_wallet,
                to_wallet=to_wallet,
                amount=command.amount,
                date=command.record_date,
                note=command.label,
                actor=user,
            )
        except ValueError as exc:
            raise CommandParseError(str(exc)) from exc

    def _wallet_keyboard(self, log_id: int, wallets: list[Wallet]) -> dict:
        buttons = [
            {
                "text": f"{'⭐ ' if wallet.is_default else ''}{wallet.name}",
                "callback_data": f"{self.WALLET_PICK_PREFIX}:{log_id}:{wallet.pk}",
            }
            for wallet in wallets
        ]
        rows = [buttons[index:index + 2] for index in range(0, len(buttons), 2)]
        rows.append(
            [
                {
                    "text": "Отмена",
                    "callback_data": (
                        f"{self.WALLET_PICK_PREFIX}:{log_id}:{self.WALLET_PICK_CANCEL}"
                    ),
                }
            ]
        )
        return {"inline_keyboard": rows}

    def _pick_wallet_text(self, command) -> str:
        money = self.reports._money(command.amount)

        if command.name == "income":
            question = f"На какой кошелёк зачислить {money} KZT?"
        else:
            question = f"С какого кошелька списать {money} KZT?"

        example_wallet = next(
            (wallet.code for wallet in self._active_wallets() if wallet.code),
            "cash",
        )
        return (
            f"{question}\n"
            f"Тип: {command.label}\n"
            f"Дата: {command.record_date.isoformat()}\n\n"
            f"Совет: кошелёк можно указать сразу — "
            f"/{command.name} {money.replace(',', '')} {example_wallet} {command.label}"
        )

    def _wallet_text(self, token: str = "") -> str:
        if token:
            wallet = Wallet.find_by_token(token, list(Wallet.objects.all()))

            if wallet is None:
                return f"Кошелёк «{token}» не найден.\n{self._wallet_codes_text()}"

            return self._wallet_detail_text(wallet)

        today = timezone.localdate()
        month_start = today.replace(day=1)
        analytics = wallet_analytics(date_from=month_start, date_to=today)
        month = f"{MONTHS_RU[today.month - 1]} {today.year}"
        lines = ["Кошельки компании", ""]

        for row in analytics["wallets"]:
            if not row["is_active"]:
                continue

            star = "⭐ " if row["is_default"] else ""
            lines.extend(
                [
                    f"{star}{row['name']} ({row['code']})",
                    f"   Баланс: {self.reports._money(row['balance'])} KZT",
                    f"   За {month}: +{self.reports._money(row['income_total'])} / "
                    f"-{self.reports._money(row['spending_total'])}",
                ]
            )

        lines.extend(
            [
                "",
                f"Итого: {self.reports._money(analytics['totals']['balance'])} KZT",
                "",
                "Последние изменения:",
            ]
        )
        lines.extend(self._recent_logs(WalletLog.objects.all()))
        lines.extend(["", "Подробнее по кошельку: /wallet <код>"])
        return "\n".join(lines)

    def _wallet_detail_text(self, wallet: Wallet) -> str:
        today = timezone.localdate()
        month_start = today.replace(day=1)
        analytics = wallet_analytics(date_from=month_start, date_to=today)
        row = next(item for item in analytics["wallets"] if item["id"] == wallet.pk)
        money = self.reports._money
        month = f"{MONTHS_RU[today.month - 1]} {today.year}"
        lines = [
            f"Кошелёк «{wallet.name}» (код: {wallet.code})"
            + (" · основной" if wallet.is_default else "")
            + ("" if wallet.is_active else " · отключён"),
            f"Баланс: {money(wallet.balance)} KZT",
            "",
            f"За {month}:",
            f"Доходы:   +{money(row['income_total'])} KZT ({row['income_count']})",
            f"Расходы:  -{money(row['spending_total'])} KZT ({row['spending_count']})",
            f"Переводы: +{money(row['transfer_in'])} / -{money(row['transfer_out'])} KZT",
            f"Итого:    {money(row['net'])} KZT",
            "",
        ]

        if row["spending_by_type"]:
            max_value = max(Decimal(item["total_amount"]) for item in row["spending_by_type"])
            lines.append("Расходы по категориям")

            for item in row["spending_by_type"]:
                lines.append(
                    f"{item['type'][:14]:14} "
                    f"{self.reports._bar(Decimal(item['total_amount']), max_value)} "
                    f"{money(item['total_amount'])} KZT ({item['count']})"
                )

            lines.append("")

        lines.append("Последние операции:")
        lines.extend(self._recent_logs(WalletLog.objects.filter(wallet=wallet)))
        return "\n".join(lines)

    def _recent_logs(self, queryset, limit: int = 5) -> list[str]:
        logs = queryset.select_related("actor", "wallet").order_by("-created_at", "-id")[:limit]

        if not logs:
            return ["Пока нет изменений."]

        lines = []

        for log in logs:
            actor = self._actor_name(log.actor)
            created_at = timezone.localtime(log.created_at).strftime("%Y-%m-%d %H:%M")
            sign = "+" if log.amount_delta >= 0 else ""
            description = log.description or log.get_action_display()
            wallet = f"[{log.wallet.name}] " if log.wallet else ""
            lines.append(
                f"{created_at} {wallet}{sign}{self.reports._money(log.amount_delta)} KZT "
                f"- {description} ({actor})"
            )

        return lines

    def _wallet_codes_text(self) -> str:
        wallets = self._active_wallets()
        codes = ", ".join(f"{wallet.code} ({wallet.name})" for wallet in wallets)
        return f"Кошельки: {codes}" if codes else "Кошельков пока нет."

    # ----- plumbing -----

    def _existing_log(self, update_id):
        if update_id is None:
            return None

        return TelegramCommandLog.objects.filter(update_id=update_id).first()

    def _log_ignored(self, update_id, chat_data: dict, from_data: dict) -> dict:
        chat = self._upsert_chat(chat_data)
        user = self._user(from_data)
        log = TelegramCommandLog.objects.create(
            update_id=update_id,
            chat=chat,
            user=user,
            telegram_user_id=from_data.get("id"),
            telegram_chat_id=chat_data.get("id"),
            status=TelegramCommandLog.Status.IGNORED,
        )
        return {"duplicate": False, "log_id": log.id, "status": log.status}

    def _upsert_chat(self, chat_data: dict) -> TelegramChat | None:
        chat_id = chat_data.get("id")

        if not chat_id:
            return None

        defaults = {
            "title": chat_data.get("title") or chat_data.get("username") or "",
            "type": chat_data.get("type", ""),
            "is_active": True,
        }
        chat, _ = TelegramChat.objects.update_or_create(
            chat_id=chat_id,
            defaults=defaults,
        )
        return chat

    def _user(self, from_data: dict):
        telegram_user_id = from_data.get("id")

        if not telegram_user_id:
            return None

        return (
            get_user_model()
            .objects.select_related("employee")
            .filter(telegram_id=telegram_user_id)
            .first()
        )

    def _require_accounting(self, user, permission_field: str) -> None:
        if not user or not user.is_authenticated:
            raise PermissionError("Telegram аккаунт не привязан к CRM-пользователю.")

        if user.is_staff or user.is_superuser:
            return

        try:
            employee = user.employee
        except ObjectDoesNotExist as exc:
            raise PermissionError("У CRM-пользователя нет профиля сотрудника.") from exc

        if not getattr(employee, permission_field, False):
            raise PermissionError("У вас нет прав для этой команды.")

    def _created_text(self, command, wallet: Wallet) -> str:
        label = "доход" if command.name == "income" else "расход"
        return (
            f"Создан {label}.\n"
            f"Сумма: {command.amount} KZT\n"
            f"Тип: {command.label}\n"
            f"Кошелёк: {wallet.name}\n"
            f"Дата: {command.record_date.isoformat()}"
        )

    def _transfer_text(self, transfer) -> str:
        lines = [
            "Перевод выполнен.",
            f"Сумма: {self.reports._money(transfer.amount)} KZT",
            f"Откуда: {transfer.from_wallet.name}",
            f"Куда: {transfer.to_wallet.name}",
            f"Дата: {transfer.date.isoformat()}",
        ]

        if transfer.note:
            lines.append(f"Заметка: {transfer.note}")

        return "\n".join(lines)

    def _whoami_text(self, from_data: dict, user) -> str:
        lines = [
            f"Telegram ID: {from_data.get('id')}",
            f"Username: @{from_data.get('username')}" if from_data.get("username") else "Username: -",
        ]

        if user:
            lines.append(f"CRM пользователь: {user}")
        else:
            lines.append("CRM пользователь: не привязан")

        return "\n".join(lines)

    def _not_linked_text(self, from_data: dict) -> str:
        return (
            "Ваш Telegram аккаунт не привязан к CRM.\n"
            f"Отправьте этот Telegram ID администратору: {from_data.get('id')}\n"
            "Администратор должен указать его в поле telegram_id у CRM-пользователя."
        )

    def _actor_name(self, actor) -> str:
        if not actor:
            return "system"

        return actor.get_full_name() or actor.email or actor.username or str(actor)

    def _help_text(self) -> str:
        wallets = self._active_wallets()
        example = next((wallet.code for wallet in wallets if not wallet.is_default), None)
        example = example or (wallets[0].code if wallets else "cash")
        return (
            "Команды CRM-бота:\n\n"
            "1. Добавить доход\n"
            "/income 15000 website\n"
            f"/income 15000 {example} website 2026-06-09\n\n"
            "2. Добавить расход\n"
            "/spending 5000 ads\n"
            f"/spending 5000 {example} такси\n"
            "/spending 5000 office yesterday\n"
            "Без кошелька бот предложит выбрать его кнопками.\n\n"
            "3. Перевод между кошельками\n"
            f"/transfer 100000 <откуда> <куда> [заметка]\n\n"
            "4. Получить отчет\n"
            "/report week\n"
            "/report month\n"
            "/report 2026-06-01 2026-06-09\n\n"
            "5. Кошельки\n"
            "/wallet — все кошельки и движение за месяц\n"
            f"/wallet {example} — подробно по одному кошельку\n\n"
            "6. Узнать свой Telegram ID\n"
            "/whoami\n\n"
            f"{self._wallet_codes_text()}\n"
            "Периоды: week, month, year, all.\n"
            "Даты: today, yesterday, YYYY-MM-DD или DD.MM.YYYY.\n\n"
            "Перед использованием бота администратор должен указать ваш Telegram ID "
            "в CRM-пользователе."
        )
