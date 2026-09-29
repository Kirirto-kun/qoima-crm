from rest_framework.routers import DefaultRouter

from src.wallets.views import WalletLogViewSet, WalletTransferViewSet, WalletViewSet

router = DefaultRouter()
router.register("logs", WalletLogViewSet, basename="wallet-logs")
router.register("transfers", WalletTransferViewSet, basename="wallet-transfers")
router.register("", WalletViewSet, basename="wallets")

urlpatterns = router.urls
