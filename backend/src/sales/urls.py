from rest_framework.routers import DefaultRouter

from src.sales.views import (
    EventParticipantViewSet,
    HotLeadViewSet,
    LeadViewSet,
    SalesEventViewSet,
)

router = DefaultRouter()
router.register("events", SalesEventViewSet, basename="sales-events")
router.register(
    "event-participants",
    EventParticipantViewSet,
    basename="sales-event-participants",
)
router.register("hot-leads", HotLeadViewSet, basename="sales-hot-leads")
router.register("", LeadViewSet, basename="sales-leads")

urlpatterns = router.urls
