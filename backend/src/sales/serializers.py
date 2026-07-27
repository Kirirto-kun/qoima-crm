from rest_framework import serializers

from src.sales.models import EventParticipant, HotLead, Lead, SalesEvent


class HotLeadSerializer(serializers.ModelSerializer):
    class Meta:
        model = HotLead
        fields = (
            "id",
            "name",
            "contact",
            "note",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Укажите имя или название.")
        return value

    def validate_contact(self, value):
        if not value.strip():
            raise serializers.ValidationError("Укажите контакт — телефон или почту.")
        return value


class LeadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lead
        fields = (
            "id",
            "lead_name",
            "company",
            "amount",
            "comments",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Сумма должна быть больше нуля.")
        return value


class EventParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventParticipant
        fields = (
            "id",
            "event",
            "lead_name",
            "company",
            "amount",
            "comments",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Сумма должна быть больше нуля.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        event = attrs.get("event") or getattr(self.instance, "event", None)

        if event and self.instance is None:
            if event.participants.count() >= event.capacity:
                raise serializers.ValidationError(
                    {"event": "В событии уже нет свободных мест."}
                )

        return attrs


class SalesEventSerializer(serializers.ModelSerializer):
    participants = EventParticipantSerializer(many=True, read_only=True)
    participant_count = serializers.SerializerMethodField()
    total_amount = serializers.SerializerMethodField()

    class Meta:
        model = SalesEvent
        fields = (
            "id",
            "name",
            "event_date",
            "capacity",
            "comments",
            "participant_count",
            "total_amount",
            "participants",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "participant_count",
            "total_amount",
            "participants",
            "created_at",
            "updated_at",
        )

    def get_participant_count(self, obj):
        return obj.participants.count()

    def get_total_amount(self, obj):
        total = sum(
            (participant.amount for participant in obj.participants.all()),
            start=0,
        )
        return f"{total:.2f}"

    def validate_capacity(self, value):
        if value <= 0:
            raise serializers.ValidationError(
                "Количество мест должно быть больше нуля."
            )

        if self.instance and self.instance.participants.count() > value:
            raise serializers.ValidationError(
                "Количество мест не может быть меньше числа участников."
            )

        return value
