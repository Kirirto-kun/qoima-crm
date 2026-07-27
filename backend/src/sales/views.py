from core.permissions import SalesPermissions
from rest_framework import filters, viewsets

from src.sales.models import EventParticipant, HotLead, Lead, SalesEvent
from src.sales.serializers import (
    EventParticipantSerializer,
    HotLeadSerializer,
    LeadSerializer,
    SalesEventSerializer,
)


class HotLeadViewSet(viewsets.ModelViewSet):
    queryset = HotLead.objects.all()
    serializer_class = HotLeadSerializer
    permission_classes = (SalesPermissions,)
    filter_backends = (filters.SearchFilter, filters.OrderingFilter)
    search_fields = ("name", "contact", "note")
    ordering_fields = ("name", "contact", "created_at", "updated_at")


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
