from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from core.enums import UserRole
from src.spendings.models import Spending
from src.telegram_bot.models import TelegramCommandLog
from src.telegram_bot.services.handler import TelegramBotService
from src.wallets.models import Wallet, WalletTransfer

TELEGRAM_ID = 555001


@override_settings(TELEGRAM_BOT_TOKEN="")
class TelegramWalletCommandTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser(
            username="boss",
            email="boss@example.com",
            password="password",
            role=UserRole.EMPLOYEE,
            telegram_id=TELEGRAM_ID,
        )
        self.main = Wallet.default()
        self.main.balance = "100000.00"
        self.main.save(update_fields=("balance",))
        self.cash = Wallet.objects.create(name="Наличные", code="cash", balance="50000.00")
        self.update_id = 1000
        self.sent = []
        self.edited = []
        patcher_send = patch(
            "src.telegram_bot.services.telegram.TelegramClient.send_message_with_result",
            side_effect=lambda chat_id, text, reply_markup=None: self.sent.append(
                (text, reply_markup)
            ) or {"ok": True},
        )
        patcher_edit = patch(
            "src.telegram_bot.services.telegram.TelegramClient.edit_message_text",
            side_effect=lambda chat_id, message_id, text, reply_markup=None: self.edited.append(
                text
            ) or True,
        )
        patcher_send.start()
        patcher_edit.start()
        self.addCleanup(patcher_send.stop)
        self.addCleanup(patcher_edit.stop)

    def message(self, text):
        self.update_id += 1
        return TelegramBotService().handle_update(
            {
                "update_id": self.update_id,
                "message": {
                    "message_id": 1,
                    "text": text,
                    "chat": {"id": 42, "type": "private"},
                    "from": {"id": TELEGRAM_ID, "username": "boss"},
                },
            }
        )

    def callback(self, data, telegram_id=TELEGRAM_ID):
        self.update_id += 1
        return TelegramBotService().handle_update(
            {
                "update_id": self.update_id,
                "callback_query": {
                    "id": "cb",
                    "data": data,
                    "from": {"id": telegram_id},
                    "message": {"message_id": 7, "chat": {"id": 42}},
                },
            }
        )

    def test_spending_with_wallet_code_is_charged_to_that_wallet(self):
        result = self.message("/spending 5000 cash такси")

        self.assertEqual(result["status"], "success")
        spending = Spending.objects.get()
        self.assertEqual(spending.wallet, self.cash)
        self.assertEqual(spending.type, "такси")
        self.cash.refresh_from_db()
        self.assertEqual(self.cash.balance, Decimal("45000.00"))

    def test_wallet_name_at_the_end_is_recognised(self):
        self.message("/spending 3000 такси наличные")

        spending = Spending.objects.get()
        self.assertEqual(spending.wallet, self.cash)
        self.assertEqual(spending.type, "такси")

    def test_spending_without_wallet_asks_with_buttons(self):
        result = self.message("/spending 5000 такси")

        self.assertEqual(result["status"], "pending")
        self.assertFalse(Spending.objects.exists())
        text, markup = self.sent[-1]
        self.assertIn("С какого кошелька", text)
        callbacks = [
            button["callback_data"]
            for row in markup["inline_keyboard"]
            for button in row
        ]
        self.assertIn(f"wpick:{result['log_id']}:{self.cash.pk}", callbacks)

        picked = self.callback(f"wpick:{result['log_id']}:{self.cash.pk}")

        self.assertEqual(picked["status"], "success")
        spending = Spending.objects.get()
        self.assertEqual(spending.wallet, self.cash)
        self.assertEqual(spending.amount, Decimal("5000"))
        self.assertIn("Кошелёк: Наличные", self.edited[-1])
        log = TelegramCommandLog.objects.get(pk=result["log_id"])
        self.assertEqual(log.status, "success")

        # A second tap must not create a duplicate.
        self.callback(f"wpick:{result['log_id']}:{self.main.pk}")
        self.assertEqual(Spending.objects.count(), 1)

    def test_pending_spending_can_be_cancelled(self):
        result = self.message("/spending 5000 такси")

        self.callback(f"wpick:{result['log_id']}:x")

        self.assertFalse(Spending.objects.exists())
        self.assertEqual(
            TelegramCommandLog.objects.get(pk=result["log_id"]).status,
            "ignored",
        )

    def test_only_author_can_pick_wallet(self):
        result = self.message("/spending 5000 такси")

        picked = self.callback(f"wpick:{result['log_id']}:{self.cash.pk}", telegram_id=999)

        self.assertEqual(picked["status"], "denied")
        self.assertFalse(Spending.objects.exists())

    def test_single_active_wallet_is_used_without_asking(self):
        self.cash.is_active = False
        self.cash.save(update_fields=("is_active",))

        result = self.message("/spending 5000 такси")

        self.assertEqual(result["status"], "success")
        self.assertEqual(Spending.objects.get().wallet, self.main)

    def test_transfer_command(self):
        result = self.message("/transfer 20000 company-wallet cash снятие")

        self.assertEqual(result["status"], "success")
        transfer = WalletTransfer.objects.get()
        self.assertEqual(transfer.note, "снятие")
        self.main.refresh_from_db()
        self.cash.refresh_from_db()
        self.assertEqual(self.main.balance, Decimal("80000.00"))
        self.assertEqual(self.cash.balance, Decimal("70000.00"))

    def test_wallet_commands_render(self):
        service = TelegramBotService()
        overview = service._wallet_text()
        detail = service._wallet_text("cash")

        self.assertIn("Наличные (cash)", overview)
        self.assertIn("Итого:", overview)
        self.assertIn("Кошелёк «Наличные»", detail)
        self.assertIn("не найден", service._wallet_text("nope"))
        report = service.reports.build(service.parser.parse("/report month"))
        self.assertIn("By wallet", report)
        self.assertIn("Наличные", report)
