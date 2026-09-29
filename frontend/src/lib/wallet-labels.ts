import type { WalletLogAction } from "./types";

export interface WalletActionMeta {
  label: string;
  /** Tag tone for the badge. */
  tone:
    | "green"
    | "red"
    | "blue"
    | "purple"
    | "orange"
    | "gray"
    | "yellow";
  /** True when this action represents money flowing INTO the wallet. */
  positive: boolean;
}

const META: Record<WalletLogAction, WalletActionMeta> = {
  wallet_created: { label: "Кошелёк создан", tone: "blue", positive: true },
  wallet_updated: { label: "Кошелёк обновлён", tone: "purple", positive: true },
  wallet_deleted: { label: "Кошелёк удалён", tone: "gray", positive: false },
  wallet_initialized: { label: "Кошелёк инициализирован", tone: "blue", positive: true },
  income_created: { label: "Доход добавлен", tone: "green", positive: true },
  income_updated: { label: "Доход изменён", tone: "yellow", positive: true },
  income_deleted: { label: "Доход удалён", tone: "orange", positive: false },
  spending_created: { label: "Расход добавлен", tone: "red", positive: false },
  spending_updated: { label: "Расход изменён", tone: "yellow", positive: false },
  spending_deleted: { label: "Расход удалён", tone: "orange", positive: true },
  transfer_out: { label: "Перевод: списание", tone: "purple", positive: false },
  transfer_in: { label: "Перевод: зачисление", tone: "blue", positive: true },
  transfer_deleted: { label: "Перевод отменён", tone: "gray", positive: true },
};

const FALLBACK: WalletActionMeta = {
  label: "Изменение",
  tone: "gray",
  positive: true,
};

export function walletActionMeta(action: WalletLogAction | string): WalletActionMeta {
  return META[action as WalletLogAction] ?? FALLBACK;
}
