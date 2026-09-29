from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from core.enums import UserRole
from src.employees.models import Employee
from src.wallets.models import Wallet, WalletLog


class WalletBalanceVisibilityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="cashier",
            email="cashier@example.com",
            password="password",
            role=UserRole.EMPLOYEE,
        )
        self.employee = Employee.objects.create(
            user=self.user,
            role="Cashier",
            salary="100000.00",
        )
        self.wallet = Wallet.default()
        self.wallet.name = "Company wallet"
        self.wallet.balance = "9850000.00"
        self.wallet.save(update_fields=("name", "balance"))
        WalletLog.objects.create(
            wallet=self.wallet,
            actor=self.user,
            action=WalletLog.Action.SPENDING_CREATED,
            amount_delta="-15000.00",
            balance_before="9865000.00",
            balance_after="9850000.00",
            description="Spending created: Builder.io",
        )

    def test_wallet_balance_and_logs_are_masked_without_permission(self):
        self.client.force_authenticate(self.user)

        wallet_response = self.client.get("/api/wallets/current/")
        logs_response = self.client.get("/api/wallets/logs/")

        self.assertEqual(wallet_response.status_code, 200)
        self.assertFalse(wallet_response.data["can_view_balance"])
        self.assertIsNone(wallet_response.data["balance"])

        self.assertEqual(logs_response.status_code, 200)
        log = self.results(logs_response)[0]
        self.assertFalse(log["can_view_balance"])
        self.assertIsNone(log["amount_delta"])
        self.assertIsNone(log["balance_before"])
        self.assertIsNone(log["balance_after"])

    def test_wallet_balance_and_logs_are_visible_with_permission(self):
        self.employee.wallets_can_view_balance = True
        self.employee.save(update_fields=("wallets_can_view_balance",))
        self.client.force_authenticate(self.user)

        wallet_response = self.client.get("/api/wallets/current/")
        logs_response = self.client.get("/api/wallets/logs/")

        self.assertEqual(wallet_response.status_code, 200)
        self.assertTrue(wallet_response.data["can_view_balance"])
        self.assertEqual(wallet_response.data["balance"], "9850000.00")

        self.assertEqual(logs_response.status_code, 200)
        log = self.results(logs_response)[0]
        self.assertTrue(log["can_view_balance"])
        self.assertEqual(log["amount_delta"], "-15000.00")
        self.assertEqual(log["balance_before"], "9865000.00")
        self.assertEqual(log["balance_after"], "9850000.00")

    def results(self, response):
        return response.data.get("results", response.data)


class MultiWalletTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = get_user_model().objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="password",
            role=UserRole.EMPLOYEE,
        )
        self.client.force_authenticate(self.admin)
        self.main = Wallet.default()
        self.main.balance = "1000000.00"
        self.main.save(update_fields=("balance",))
        self.cash = Wallet.objects.create(name="Наличные", code="cash", balance="200000.00")

    def refresh(self):
        self.main.refresh_from_db()
        self.cash.refresh_from_db()

    def test_wallet_code_is_generated_from_name(self):
        wallet = Wallet.objects.create(name="Kaspi Gold")
        self.assertEqual(wallet.code, "kaspi-gold")
        self.assertEqual(Wallet.find_by_token("kaspi_gold"), wallet)
        self.assertEqual(Wallet.find_by_token("KaspiGold"), wallet)

    def test_spending_defaults_to_main_wallet(self):
        response = self.client.post(
            "/api/spendings/",
            {"name": "AWS", "type": "infrastructure", "amount": "15000.00"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["wallet"], self.main.pk)
        self.assertEqual(response.data["wallet_name"], self.main.name)
        self.refresh()
        self.assertEqual(self.main.balance, Decimal("985000.00"))
        self.assertEqual(self.cash.balance, Decimal("200000.00"))

    def test_spending_and_income_hit_selected_wallet(self):
        spending = self.client.post(
            "/api/spendings/",
            {"name": "Такси", "type": "travel", "amount": "5000", "wallet": self.cash.pk},
            format="json",
        )
        income = self.client.post(
            "/api/incomes/",
            {"name": "Оплата", "type": "project", "amount": "70000", "wallet": self.cash.pk},
            format="json",
        )

        self.assertEqual(spending.status_code, 201)
        self.assertEqual(income.status_code, 201)
        self.refresh()
        self.assertEqual(self.cash.balance, Decimal("265000.00"))
        self.assertEqual(self.main.balance, Decimal("1000000.00"))

    def test_moving_spending_between_wallets_refunds_old_wallet(self):
        created = self.client.post(
            "/api/spendings/",
            {"name": "Офис", "type": "office", "amount": "10000", "wallet": self.main.pk},
            format="json",
        )
        response = self.client.patch(
            f"/api/spendings/{created.data['id']}/",
            {"wallet": self.cash.pk, "amount": "12000"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.refresh()
        self.assertEqual(self.main.balance, Decimal("1000000.00"))
        self.assertEqual(self.cash.balance, Decimal("188000.00"))

        deleted = self.client.delete(f"/api/spendings/{created.data['id']}/")
        self.assertEqual(deleted.status_code, 204)
        self.refresh()
        self.assertEqual(self.cash.balance, Decimal("200000.00"))

    def test_inactive_wallet_cannot_receive_new_records(self):
        self.cash.is_active = False
        self.cash.save(update_fields=("is_active",))

        response = self.client.post(
            "/api/spendings/",
            {"name": "Такси", "type": "travel", "amount": "5000", "wallet": self.cash.pk},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("wallet", response.data)

    def test_transfer_moves_money_and_can_be_reverted(self):
        response = self.client.post(
            "/api/wallets/transfers/",
            {
                "from_wallet": self.main.pk,
                "to_wallet": self.cash.pk,
                "amount": "300000",
                "note": "Сняли наличные",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.refresh()
        self.assertEqual(self.main.balance, Decimal("700000.00"))
        self.assertEqual(self.cash.balance, Decimal("500000.00"))
        self.assertEqual(
            list(
                WalletLog.objects.filter(related_object_id=str(response.data["id"]))
                .order_by("id")
                .values_list("action", flat=True)
            ),
            ["transfer_out", "transfer_in"],
        )

        deleted = self.client.delete(f"/api/wallets/transfers/{response.data['id']}/")
        self.assertEqual(deleted.status_code, 204)
        self.refresh()
        self.assertEqual(self.main.balance, Decimal("1000000.00"))
        self.assertEqual(self.cash.balance, Decimal("200000.00"))

    def test_transfer_to_same_wallet_is_rejected(self):
        response = self.client.post(
            "/api/wallets/transfers/",
            {"from_wallet": self.cash.pk, "to_wallet": self.cash.pk, "amount": "1"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_wallet_with_operations_cannot_be_deleted(self):
        self.client.post(
            "/api/spendings/",
            {"name": "Такси", "type": "travel", "amount": "5000", "wallet": self.cash.pk},
            format="json",
        )

        response = self.client.delete(f"/api/wallets/{self.cash.pk}/")

        self.assertEqual(response.status_code, 400)
        self.assertTrue(Wallet.objects.filter(pk=self.cash.pk).exists())

    def test_wallet_analytics_splits_flows_per_wallet(self):
        self.client.post(
            "/api/spendings/",
            {
                "name": "Такси",
                "type": "travel",
                "amount": "5000",
                "wallet": self.cash.pk,
                "date_spend": "2026-09-10",
            },
            format="json",
        )
        self.client.post(
            "/api/incomes/",
            {
                "name": "Оплата",
                "type": "project",
                "amount": "90000",
                "date_earned": "2026-09-11",
            },
            format="json",
        )
        self.client.post(
            "/api/spendings/",
            {
                "name": "Старое",
                "type": "office",
                "amount": "1000",
                "wallet": self.cash.pk,
                "date_spend": "2026-01-10",
            },
            format="json",
        )

        response = self.client.get(
            "/api/wallets/analytics/",
            {"from_date": "2026-09-01", "to_date": "2026-09-30"},
        )

        self.assertEqual(response.status_code, 200)
        rows = {row["id"]: row for row in response.data["wallets"]}
        self.assertEqual(rows[self.cash.pk]["spending_total"], "5000.00")
        self.assertEqual(rows[self.cash.pk]["spending_count"], 1)
        self.assertEqual(rows[self.cash.pk]["spending_by_type"][0]["type"], "travel")
        self.assertEqual(rows[self.main.pk]["income_total"], "90000.00")
        self.assertEqual(response.data["totals"]["spending_total"], "5000.00")
        self.assertEqual(response.data["group_by"], "day")
        self.assertEqual(len(response.data["timeline"]), 30)

    def test_wallet_analytics_is_masked_without_balance_permission(self):
        user = get_user_model().objects.create_user(
            username="viewer",
            email="viewer@example.com",
            password="password",
            role=UserRole.EMPLOYEE,
        )
        Employee.objects.create(user=user, role="Viewer", salary="1.00")
        self.client.force_authenticate(user)

        response = self.client.get("/api/wallets/analytics/")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["can_view_balance"])
        self.assertIsNone(response.data["totals"]["balance"])
        self.assertIsNone(response.data["wallets"][0]["spending_total"])

    def test_spending_list_paginates_with_stable_order_and_filters(self):
        wallet_ids = [self.main.pk, self.cash.pk]
        for index in range(60):
            self.client.post(
                "/api/spendings/",
                {
                    "name": f"#{index}",
                    "type": "travel" if index % 2 else "office",
                    "amount": "10",
                    "wallet": wallet_ids[index % 2],
                    "date_spend": "2026-09-01",
                },
                format="json",
            )

        first = self.client.get("/api/spendings/")
        second = self.client.get("/api/spendings/", {"page": 2})
        ids = [row["id"] for row in first.data["results"] + second.data["results"]]

        self.assertEqual(first.data["count"], 60)
        self.assertEqual(len(set(ids)), 60)

        analytics = self.client.get(
            "/api/spendings/analytics/",
            {"wallet": self.cash.pk, "type": "travel"},
        )
        self.assertEqual(analytics.data["total"]["count"], 30)
        self.assertEqual(
            {row["type"] for row in analytics.data["by_type"]},
            {"travel"},
        )
        self.assertEqual(
            {row["wallet"] for row in analytics.data["by_wallet"]},
            {self.cash.pk},
        )
