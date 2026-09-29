from django.conf import settings
from django.db import models


class TelegramChat(models.Model):
    chat_id = models.BigIntegerField(unique=True, db_index=True)
    title = models.CharField(max_length=255, blank=True, default="")
    type = models.CharField(max_length=32, blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)

    def __str__(self):
        return self.title or str(self.chat_id)


class TelegramBotConfig(models.Model):
    name = models.CharField(max_length=120, unique=True, default="default")
    task_approval_chat = models.ForeignKey(
        TelegramChat,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bot_configs",
    )
    settings = models.JSONField(blank=True, default=dict)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)

    def __str__(self):
        return self.name

    @classmethod
    def active(cls):
        return (
            cls.objects.select_related("task_approval_chat")
            .filter(is_active=True)
            .order_by("-updated_at")
            .first()
        )


class TelegramAccount(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="telegram_account",
    )
    telegram_user_id = models.BigIntegerField(unique=True, db_index=True)
    username = models.CharField(max_length=150, blank=True, default="")
    first_name = models.CharField(max_length=150, blank=True, default="")
    last_name = models.CharField(max_length=150, blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("user__username",)

    def __str__(self):
        handle = f"@{self.username}" if self.username else self.telegram_user_id
        return f"{self.user} ({handle})"


class TelegramCommandLog(models.Model):
    class Status(models.TextChoices):
        SUCCESS = "success", "Success"
        DENIED = "denied", "Denied"
        FAILED = "failed", "Failed"
        IGNORED = "ignored", "Ignored"
        PENDING = "pending", "Pending"

    update_id = models.BigIntegerField(unique=True, null=True, blank=True)
    chat = models.ForeignKey(
        TelegramChat,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="command_logs",
    )
    account = models.ForeignKey(
        TelegramAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="command_logs",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="telegram_command_logs",
    )
    telegram_user_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    telegram_chat_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    command = models.CharField(max_length=40, blank=True, default="")
    text = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.SUCCESS,
    )
    response = models.TextField(blank=True, default="")
    error = models.TextField(blank=True, default="")
    created_object_type = models.CharField(max_length=80, blank=True, default="")
    created_object_id = models.CharField(max_length=80, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.command or 'message'} {self.status}"
