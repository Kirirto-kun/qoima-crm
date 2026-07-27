from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from core.enums import UserRole
from src.employees.models import Employee
from src.sales.models import EventParticipant, HotLead, Lead, SalesEvent


class SalesLeadApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.employee = get_user_model().objects.create_user(
            username="sales-manager",
            email="sales@example.com",
            password="password",
            role=UserRole.EMPLOYEE,
        )
        self.employee_profile = Employee.objects.create(
            user=self.employee,
            role="Sales manager",
            salary="300000.00",
            sales_can_retrieve=True,
            sales_can_create=True,
            sales_can_update=True,
            sales_can_delete=True,
        )
        self.collaborator = get_user_model().objects.create_user(
            username="client",
            email="client@example.com",
            password="password",
            role=UserRole.COLLABORATOR,
        )

    def test_employee_can_create_and_list_leads(self):
        self.client.force_authenticate(self.employee)

        created = self.client.post(
            "/api/sales/",
            {
                "lead_name": "Айдана Садыкова",
                "company": "Alem Logistics",
                "amount": "1250000.00",
                "comments": "Запросили коммерческое предложение",
            },
            format="json",
        )

        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["lead_name"], "Айдана Садыкова")
        self.assertEqual(created.data["company"], "Alem Logistics")
        self.assertEqual(created.data["amount"], "1250000.00")
        self.assertEqual(Lead.objects.count(), 1)

        listed = self.client.get("/api/sales/")

        self.assertEqual(listed.status_code, 200)
        results = listed.data.get("results", listed.data)
        self.assertEqual(len(results), 1)

    def test_employee_can_update_and_delete_lead(self):
        lead = Lead.objects.create(
            lead_name="Данияр",
            company="QazTech",
            amount="500000.00",
        )
        self.client.force_authenticate(self.employee)

        updated = self.client.patch(
            f"/api/sales/{lead.id}/",
            {"amount": "750000.00", "comments": "Повторный созвон"},
            format="json",
        )

        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["amount"], "750000.00")

        deleted = self.client.delete(f"/api/sales/{lead.id}/")

        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(Lead.objects.filter(id=lead.id).exists())

    def test_amount_must_be_positive(self):
        self.client.force_authenticate(self.employee)

        response = self.client.post(
            "/api/sales/",
            {
                "lead_name": "Лид",
                "company": "Компания",
                "amount": "0.00",
                "comments": "",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("amount", response.data)

    def test_collaborator_cannot_access_sales(self):
        self.client.force_authenticate(self.collaborator)

        response = self.client.get("/api/sales/")

        self.assertEqual(response.status_code, 403)

    def test_sales_permissions_are_checked_per_action(self):
        self.employee_profile.sales_can_retrieve = False
        self.employee_profile.sales_can_create = False
        self.employee_profile.sales_can_update = False
        self.employee_profile.sales_can_delete = False
        self.employee_profile.save(
            update_fields=(
                "sales_can_retrieve",
                "sales_can_create",
                "sales_can_update",
                "sales_can_delete",
            ),
        )
        self.client.force_authenticate(self.employee)
        lead = Lead.objects.create(
            lead_name="Закрытый лид",
            company="Private Co",
            amount="2000.00",
        )

        denied_list = self.client.get("/api/sales/")
        denied_create = self.client.post(
            "/api/sales/",
            {
                "lead_name": "Лид",
                "company": "Компания",
                "amount": "1000.00",
            },
            format="json",
        )
        denied_update = self.client.patch(
            f"/api/sales/{lead.id}/",
            {"comments": "Нет доступа"},
            format="json",
        )
        denied_delete = self.client.delete(f"/api/sales/{lead.id}/")

        self.assertEqual(denied_list.status_code, 403)
        self.assertEqual(denied_create.status_code, 403)
        self.assertEqual(denied_update.status_code, 403)
        self.assertEqual(denied_delete.status_code, 403)

        self.employee_profile.sales_can_retrieve = True
        self.employee_profile.save(update_fields=("sales_can_retrieve",))

        allowed_list = self.client.get("/api/sales/")
        still_denied_create = self.client.post(
            "/api/sales/",
            {
                "lead_name": "Лид",
                "company": "Компания",
                "amount": "1000.00",
            },
            format="json",
        )

        self.assertEqual(allowed_list.status_code, 200)
        self.assertEqual(still_denied_create.status_code, 403)

    def test_employee_can_create_event_and_add_participants(self):
        self.client.force_authenticate(self.employee)

        created_event = self.client.post(
            "/api/sales/events/",
            {
                "name": "Интенсив 3 августа",
                "event_date": "2026-08-03",
                "capacity": 15,
                "comments": "Группа выходного дня",
            },
            format="json",
        )

        self.assertEqual(created_event.status_code, 201)
        event_id = created_event.data["id"]

        first_participant = self.client.post(
            "/api/sales/event-participants/",
            {
                "event": event_id,
                "lead_name": "Айдана Садыкова",
                "company": "Alem Logistics",
                "amount": "100000.00",
                "comments": "Оплата по счёту",
            },
            format="json",
        )
        second_participant = self.client.post(
            "/api/sales/event-participants/",
            {
                "event": event_id,
                "lead_name": "Данияр Иманов",
                "company": "",
                "amount": "120000.00",
                "comments": "",
            },
            format="json",
        )

        self.assertEqual(first_participant.status_code, 201)
        self.assertEqual(second_participant.status_code, 201)
        self.assertEqual(EventParticipant.objects.count(), 2)

        event_detail = self.client.get(f"/api/sales/events/{event_id}/")

        self.assertEqual(event_detail.status_code, 200)
        self.assertEqual(event_detail.data["participant_count"], 2)
        self.assertEqual(event_detail.data["total_amount"], "220000.00")
        self.assertEqual(len(event_detail.data["participants"]), 2)

    def test_event_capacity_cannot_be_exceeded_or_reduced_below_group_size(self):
        event = SalesEvent.objects.create(
            name="Малая группа",
            event_date="2026-08-10",
            capacity=1,
        )
        EventParticipant.objects.create(
            event=event,
            lead_name="Первый участник",
            amount="50000.00",
        )
        self.client.force_authenticate(self.employee)

        extra_participant = self.client.post(
            "/api/sales/event-participants/",
            {
                "event": event.id,
                "lead_name": "Лишний участник",
                "amount": "50000.00",
            },
            format="json",
        )
        invalid_capacity = self.client.patch(
            f"/api/sales/events/{event.id}/",
            {"capacity": 0},
            format="json",
        )

        self.assertEqual(extra_participant.status_code, 400)
        self.assertIn("event", extra_participant.data)
        self.assertEqual(invalid_capacity.status_code, 400)
        self.assertIn("capacity", invalid_capacity.data)

    def test_sales_event_endpoints_use_sales_permissions(self):
        self.employee_profile.sales_can_retrieve = False
        self.employee_profile.sales_can_create = False
        self.employee_profile.save(
            update_fields=("sales_can_retrieve", "sales_can_create")
        )
        self.client.force_authenticate(self.employee)

        denied_list = self.client.get("/api/sales/events/")
        denied_create = self.client.post(
            "/api/sales/events/",
            {
                "name": "Закрытое событие",
                "event_date": "2026-08-20",
                "capacity": 10,
            },
            format="json",
        )

        self.assertEqual(denied_list.status_code, 403)
        self.assertEqual(denied_create.status_code, 403)

    def test_employee_can_manage_hot_leads(self):
        self.client.force_authenticate(self.employee)

        created = self.client.post(
            "/api/sales/hot-leads/",
            {
                "name": "Айдана",
                "contact": "+7 700 123 45 67",
                "note": "Запрос из Instagram",
            },
            format="json",
        )

        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["name"], "Айдана")
        self.assertEqual(created.data["contact"], "+7 700 123 45 67")
        self.assertEqual(HotLead.objects.count(), 1)

        lead_id = created.data["id"]

        listed = self.client.get("/api/sales/hot-leads/")
        self.assertEqual(listed.status_code, 200)
        results = listed.data.get("results", listed.data)
        self.assertEqual(len(results), 1)

        updated = self.client.patch(
            f"/api/sales/hot-leads/{lead_id}/",
            {"contact": "client@mail.com"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["contact"], "client@mail.com")

        deleted = self.client.delete(f"/api/sales/hot-leads/{lead_id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(HotLead.objects.filter(id=lead_id).exists())

    def test_hot_lead_requires_name_and_contact(self):
        self.client.force_authenticate(self.employee)

        response = self.client.post(
            "/api/sales/hot-leads/",
            {"name": "  ", "contact": ""},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)
        self.assertIn("contact", response.data)

    def test_hot_leads_use_sales_permissions(self):
        self.employee_profile.sales_can_retrieve = False
        self.employee_profile.sales_can_create = False
        self.employee_profile.save(
            update_fields=("sales_can_retrieve", "sales_can_create")
        )
        self.client.force_authenticate(self.employee)

        denied_list = self.client.get("/api/sales/hot-leads/")
        denied_create = self.client.post(
            "/api/sales/hot-leads/",
            {"name": "Закрытая заявка", "contact": "+7 700 000 00 00"},
            format="json",
        )

        self.assertEqual(denied_list.status_code, 403)
        self.assertEqual(denied_create.status_code, 403)

    def test_collaborator_cannot_access_hot_leads(self):
        self.client.force_authenticate(self.collaborator)

        response = self.client.get("/api/sales/hot-leads/")

        self.assertEqual(response.status_code, 403)
