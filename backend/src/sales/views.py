from core.permissions import SalesPermissions
from django.db.models import Case, IntegerField, Value, When
from rest_framework import filters, viewsets

from src.sales.models import EventParticipant, HotLead, Lead, SalesEvent
from src.sales.serializers import (
    EventParticipantSerializer,
    HotLeadSerializer,
    LeadSerializer,
    SalesEventSerializer,
)


class HotLeadViewSet(viewsets.ModelViewSet):
    serializer_class = HotLeadSerializer
    permission_classes = (SalesPermissions,)
    filter_backends = (filters.SearchFilter, filters.OrderingFilter)
    search_fields = ("name", "contact", "note")
    ordering_fields = ("name", "contact", "status", "created_at", "updated_at")

    def get_queryset(self):
        # Ожидает вверху, затем В процессе, Архив, и Удалённые (корзина) внизу.
        status_priority = Case(
            When(status=HotLead.Status.PENDING, then=Value(0)),
            When(status=HotLead.Status.IN_PROGRESS, then=Value(1)),
            When(status=HotLead.Status.ARCHIVED, then=Value(2)),
            When(status=HotLead.Status.DELETED, then=Value(3)),
            default=Value(4),
            output_field=IntegerField(),
        )
        queryset = HotLead.objects.annotate(status_priority=status_priority)

        # По умолчанию корзина (удалённые заявки) скрыта. ?trash=1 показывает только корзину.
        trash = self.request.query_params.get("trash")
        if trash in ("1", "true", "True"):
            queryset = queryset.filter(status=HotLead.Status.DELETED)
        else:
            queryset = queryset.exclude(status=HotLead.Status.DELETED)

        return queryset.order_by("status_priority", "-created_at", "-id")


class LeadViewSet(viewsets.ModelViewSet):
    queryset = Lead.objects.all()
    serializer_class = LeadSerializer
    permission_classes = (SalesPermissions,)
    filter_backends = (filters.SearchFilter, filters.OrderingFilter)
    search_fields = ("lead_name", "company", "comments")
    ordering_fields = ("lead_name", "company", "amount", "created_at", "updated_at")


class SalesEventViewSet(viewsets.ModelViewSet):
    queryset = SalesEvent.objects.prefetch_related("participants").all()
    serializer_class = SalesEventSerializer
    permission_classes = (SalesPermissions,)
    filter_backends = (filters.SearchFilter, filters.OrderingFilter)
    search_fields = ("name", "comments", "participants__lead_name", "participants__company")
    ordering_fields = ("name", "event_date", "capacity", "created_at", "updated_at")


class EventParticipantViewSet(viewsets.ModelViewSet):
    queryset = EventParticipant.objects.select_related("event").all()
    serializer_class = EventParticipantSerializer
    permission_classes = (SalesPermissions,)
    filter_backends = (filters.SearchFilter, filters.OrderingFilter)
    search_fields = ("lead_name", "company", "comments", "event__name")
    ordering_fields = ("lead_name", "company", "amount", "created_at", "updated_at")
