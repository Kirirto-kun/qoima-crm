from django.db import migrations
from django.utils.text import slugify


def backfill(apps, schema_editor):
    Wallet = apps.get_model("wallets", "Wallet")
    Income = apps.get_model("incomes", "Income")
    Spending = apps.get_model("spendings", "Spending")

    used = set(Wallet.objects.exclude(code="").values_list("code", flat=True))

    for wallet in Wallet.objects.filter(code="").order_by("id"):
        base = slugify(wallet.name or "", allow_unicode=True)[:28] or "wallet"
        code = base
        suffix = 2

        while code in used:
            code = f"{base}-{suffix}"
            suffix += 1

        used.add(code)
        wallet.code = code
        wallet.save(update_fields=("code",))

    default = Wallet.objects.filter(is_default=True).first()

    if default is None:
        return

    # Until now every income/spending moved the default wallet's balance.
    Income.objects.filter(wallet__isnull=True).update(wallet=default)
    Spending.objects.filter(wallet__isnull=True).update(wallet=default)


class Migration(migrations.Migration):

    dependencies = [
        ("wallets", "0003_wallettransfer_wallet_code_alter_walletlog_action_and_more"),
        ("incomes", "0003_alter_income_options_income_wallet"),
        ("spendings", "0005_alter_spending_options_monthlyobligation_wallet_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
