from django.db.models import Q
from django_filters import rest_framework as filters

from src.spendings.models import Spending


class SpendingFilter(filters.FilterSet):
    from_date = filters.DateFilter(field_name='date_spend', lookup_expr='gte')
    to_date = filters.DateFilter(field_name='date_spend', lookup_expr='lte')
    wallet = filters.NumberFilter(field_name='wallet_id')
    search = filters.CharFilter(method='filter_search')

    class Meta:
        model = Spending
        fields = ['from_date', 'to_date', 'type', 'wallet', 'search']

    def filter_search(self, queryset, name, value):
        value = value.strip()

        if not value:
            return queryset

        return queryset.filter(
            Q(name__icontains=value) | Q(type__icontains=value) | Q(note__icontains=value)
        )
