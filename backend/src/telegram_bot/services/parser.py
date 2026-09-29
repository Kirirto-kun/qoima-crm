from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import re

from django.utils import timezone
from django.utils.dateparse import parse_date


class CommandParseError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedCommand:
    name: str
    raw: str
    amount: Decimal | None = None
    label: str = ""
    record_date: date | None = None
    period: str = ""
    date_from: date | None = None
    date_to: date | None = None
    wallet_token: str = ""
    target_token: str = ""


class CommandParser:
    AMOUNT_RE = re.compile(
        r"^\s*(?P<amount>\d[\d\s_]*(?:[.,]\d{1,2})?)\s*(?P<tail>.*)$"
    )
    PERIODS = {"week", "month", "year", "all"}

    def parse(self, text: str) -> ParsedCommand:
        raw = text.strip()

        if not raw:
            raise CommandParseError("Empty command.")

        command, rest = self._split_command(raw)

        if command in {"start", "help"}:
            return ParsedCommand(name="help", raw=raw)

        if command == "whoami":
            return ParsedCommand(name="whoami", raw=raw)

        if command in {"wallet", "wallets", "balance"}:
            return ParsedCommand(name="wallet", raw=raw, wallet_token=rest.strip())

        if command in {"transfer", "move"}:
            return self._parse_transfer(raw, rest)

        if command == "income":
            return self._parse_money_command("income", raw, rest)

        if command in {"spending", "expense", "spend"}:
            name = "spending"
            return self._parse_money_command(name, raw, rest)

        if command == "report":
            return self._parse_report(raw, rest)

        raise CommandParseError(f"Unknown command: /{command}")

    def _split_command(self, raw: str) -> tuple[str, str]:
        if not raw.startswith("/"):
            raise CommandParseError("Use a slash command, for example /report month.")

        first, _, rest = raw.partition(" ")
        command = first.removeprefix("/").split("@", 1)[0].lower()
        return command, rest.strip()

    def _parse_money_command(
        self,
        command: str,
        raw: str,
        rest: str,
    ) -> ParsedCommand:
        match = self.AMOUNT_RE.match(rest)

        if not match:
            raise CommandParseError(
                f"Use /{command} <amount> <type> [date]."
            )

        amount = self._parse_amount(match.group("amount"))
        label, record_date = self._extract_tail_date(match.group("tail"))

        return ParsedCommand(
            name=command,
            raw=raw,
            amount=amount,
            label=label or "telegram",
            record_date=record_date or timezone.localdate(),
        )

    def _parse_transfer(self, raw: str, rest: str) -> ParsedCommand:
        usage = "Use /transfer <amount> <from_wallet> <to_wallet> [note]."
        match = self.AMOUNT_RE.match(rest)

        if not match:
            raise CommandParseError(usage)

        amount = self._parse_amount(match.group("amount"))
        tail, record_date = self._extract_tail_date(match.group("tail"))
        parts = tail.split()

        if len(parts) < 2:
            raise CommandParseError(usage)

        return ParsedCommand(
            name="transfer",
            raw=raw,
            amount=amount,
            label=" ".join(parts[2:]).strip(),
            record_date=record_date or timezone.localdate(),
            wallet_token=parts[0],
            target_token=parts[1],
        )

    def _parse_report(self, raw: str, rest: str) -> ParsedCommand:
        today = timezone.localdate()
        parts = rest.split()

        if not parts:
            return ParsedCommand(name="report", raw=raw, period="month")

        first_date = self._parse_date(parts[0], today)

        if first_date:
            second_date = self._parse_date(parts[1], today) if len(parts) > 1 else today

            if second_date is None:
                raise CommandParseError("Second report date is invalid.")

            return ParsedCommand(
                name="report",
                raw=raw,
                period="custom",
                date_from=first_date,
                date_to=second_date,
            )

        period = parts[0].lower()

        if period not in self.PERIODS:
            raise CommandParseError(
                "Use /report week, month, year, all, or two dates."
            )

        return ParsedCommand(name="report", raw=raw, period=period)

    def _extract_tail_date(self, tail: str) -> tuple[str, date | None]:
        today = timezone.localdate()
        parts = tail.split()

        if not parts:
            return "", None

        parsed = self._parse_date(parts[-1], today)

        if parsed:
            return " ".join(parts[:-1]).strip(), parsed

        return tail.strip(), None

    def _parse_amount(self, value: str) -> Decimal:
        normalized = re.sub(r"[\s_]", "", value).replace(",", ".")

        try:
            amount = Decimal(normalized)
        except InvalidOperation as error:
            raise CommandParseError("Amount is invalid.") from error

        if amount <= 0:
            raise CommandParseError("Amount must be greater than zero.")

        return amount

    def _parse_date(self, value: str, today: date) -> date | None:
        normalized = value.strip().lower()

        if normalized in {"today", "сегодня", "bugun", "бүгін"}:
            return today

        if normalized in {"yesterday", "вчера", "keshe", "кеше"}:
            return today - timedelta(days=1)

        parsed = parse_date(normalized)

        if parsed:
            return parsed

        match = re.fullmatch(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", normalized)

        if match:
            day, month, year = (int(part) for part in match.groups())

            try:
                return date(year, month, day)
            except ValueError:
                return None

        return None
