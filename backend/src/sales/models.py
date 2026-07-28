from django.db import models


class Lead(models.Model):
    lead_name = models.CharField(max_length=180)
    company = models.CharField(max_length=180)
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    comments = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self):
        return f"{self.lead_name} — {self.company}"


class HotLead(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает"
        IN_PROGRESS = "in_progress", "В процессе"
        ARCHIVED = "archived", "Архив"
        DELETED = "deleted", "Удалить"

    name = models.CharField(max_length=180)
    contact = models.CharField(max_length=180)
    note = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self):
        return f"{self.name} — {self.contact}"


class SalesEvent(models.Model):
    name = models.CharField(max_length=180)
    event_date = models.DateField(db_index=True)
    capacity = models.PositiveIntegerField()
    comments = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("event_date", "id")

    def __str__(self):
        return f"{self.name} — {self.event_date:%d.%m.%Y}"


class EventParticipant(models.Model):
    event = models.ForeignKey(
        SalesEvent,
        on_delete=models.CASCADE,
        related_name="participants",
    )
    lead_name = models.CharField(max_length=180)
    company = models.CharField(max_length=180, blank=True, default="")
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    comments = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self):
        return f"{self.lead_name} — {self.event.name}"
