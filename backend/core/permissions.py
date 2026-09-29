from django.core.exceptions import ObjectDoesNotExist
from rest_framework import permissions

from core.enums import UserRole


def is_scoped_collaborator(user):
    return (
        user
        and user.is_authenticated
        and user.role == UserRole.COLLABORATOR
        and not user.is_staff
        and not user.is_superuser
    )


def get_employee(user):
    try:
        return user.employee
    except ObjectDoesNotExist:
        return None


def has_employee_flag(user, permission_field):
    if not user or not user.is_authenticated:
        return False

    if user.is_staff or user.is_superuser:
        return True

    employee = get_employee(user)
    return bool(employee and getattr(employee, permission_field, False))


def can_view_wallet_balance(user):
    return has_employee_flag(user, "wallets_can_view_balance")


def can_view_deal_amount(user):
    return has_employee_flag(user, "deals_can_view_amount")


class IsEmployee(permissions.BasePermission):
    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.EMPLOYEE
        )


class IsCollaborator(permissions.BasePermission):
    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.COLLABORATOR
        )


class EmployeeFlagPermission(permissions.BasePermission):
    permission_map = {}

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_staff or request.user.is_superuser:
            return True

        action = getattr(view, "action", None)
        permission_field = self.permission_map.get(action)

        if permission_field is None:
            return True

        employee = self.get_employee(request.user)
        return bool(employee and getattr(employee, permission_field, False))

    def get_employee(self, user):
        return get_employee(user)


class TaskPermissions(EmployeeFlagPermission):
    permission_map = {
        "create": "tasks_can_create",
        "update": "tasks_can_edit",
        "partial_update": "tasks_can_edit",
        "destroy": "tasks_can_delete",
    }


class DealPermissions(EmployeeFlagPermission):
    permission_map = {
        "create": "deals_can_create",
        "update": "deals_can_update",
        "partial_update": "deals_can_update",
        "destroy": "deals_can_delete",
        "create_file": "deals_can_update",
        "create_payment": "deals_can_update",
        "create_stage": "deals_can_update",
        "update_stage": "deals_can_update",
        "delete_stage": "deals_can_update",
        "create_link": "deals_can_update",
        "update_link": "deals_can_update",
        "delete_link": "deals_can_update",
        "delete_file": "deals_can_update",
        "delete_payment": "deals_can_update",
    }

    def has_permission(self, request, view):
        if super().has_permission(request, view):
            return True

        if getattr(view, "action", None) == "update_stage":
            return self._is_own_stage_status_update(request, view)

        return False

    def _is_own_stage_status_update(self, request, view):
        """The stage responsible (or assignee of its auto-created task) may
        change the stage status without the deals_can_update flag."""
        if set(request.data.keys()) - {"status"}:
            return False

        from src.deals.models import DealStage
        from src.onboards.models import TaskPerformance

        stage_id = view.kwargs.get("stage_id")
        stage = DealStage.objects.filter(id=stage_id).first()

        if stage is None:
            return False

        if stage.responsible_id == request.user.id:
            return True

        return TaskPerformance.objects.filter(
            task__deal_stage=stage,
            user=request.user,
        ).exists()


class EmployeePermissions(EmployeeFlagPermission):
    permission_map = {
        "create": "employees_can_create",
        "update": "employees_can_update",
        "partial_update": "employees_can_update",
        "destroy": "employees_can_delete",
    }


class AccountingPermissions(EmployeeFlagPermission):
    permission_map = {
        "list": "accounting_can_retrieve",
        "retrieve": "accounting_can_retrieve",
        "analytics": "accounting_can_retrieve",
        "create": "accounting_can_create",
        "update": "accounting_can_update",
        "partial_update": "accounting_can_update",
        "destroy": "accounting_can_delete",
        "exclude_current_month": "accounting_can_update",
        "clear_current_month_exclusion": "accounting_can_update",
        "charge_due": "accounting_can_update",
    }


class ClientsPermissions(EmployeeFlagPermission):
    permission_map = {
        "list": "clients_can_retrieve",
        "retrieve": "clients_can_retrieve",
        "create": "clients_can_create",
        "update": "clients_can_update",
        "partial_update": "clients_can_update",
        "set_password": "clients_can_update",
        "destroy": "clients_can_delete",
        "activate": "clients_can_delete",
    }


class SalesPermissions(EmployeeFlagPermission):
    permission_map = {
        "list": "sales_can_retrieve",
        "retrieve": "sales_can_retrieve",
        "create": "sales_can_create",
        "update": "sales_can_update",
        "partial_update": "sales_can_update",
        "destroy": "sales_can_delete",
    }


class WalletPermissions(EmployeeFlagPermission):
    permission_map = {
        "create": "wallets_can_create",
        "update": "wallets_can_update",
        "partial_update": "wallets_can_update",
        "destroy": "wallets_can_delete",
    }


class WalletTransferPermissions(EmployeeFlagPermission):
    permission_map = {
        "create": "wallets_can_update",
        "destroy": "wallets_can_update",
    }
