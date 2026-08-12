/** Harcama kategorileri — apps-script/Code.gs içindeki CATEGORIES ile birebir aynı olmalı. */
export const CATEGORIES = [
  "Market",
  "Yemek",
  "Ulaşım",
  "Alışveriş",
  "Sağlık",
  "Eğitim",
  "Eğlence",
  "Fatura",
  "Diğer",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** AI'ın fişten çıkardığı ham alanlar. Fişte olmayan alanlar null/boş kalır. */
export type ExtractedReceipt = {
  merchant: string;
  date: string; // yyyy-mm-dd
  time: string; // HH:mm
  category: Category;
  total: number | null;
  currency: string;
  tax: number | null;
  bankName: string;
  items: string[];
};

/** Uygulamadaki bir fiş kaydı: AI çıktısı + görsel + kullanıcı düzenlemeleri. */
export type Receipt = ExtractedReceipt & {
  id: string;
  /** Drive'a yüklenecek görsel (data URI değil, saf base64). */
  imageBase64: string;
  imageMimeType: string;
  /** Önizleme için data URI. */
  previewUrl: string;
  sourceFileName: string;
};

/** Google Sheet'ten dönen geçmiş kayıt. */
export type HistoryReceipt = {
  merchant: string;
  date: string;
  time: string;
  category: string;
  total: number | string;
  currency: string;
  tax: number | string;
  bankName: string;
  items: string[];
  imageUrl: string;
  thumbnailUrl: string;
  uploadedAt: string;
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/** AI bazen "842,50" / "₺842.50" gibi değerler döndürebiliyor; sayıya çevirir. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const cleaned = String(value).replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;

  // "1.234,56" (TR) → "1234.56" ; "1,234.56" (EN) → "1234.56"
  const normalized =
    cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Görüntüleme için para birimi biçimlendirir. */
export function formatAmount(value: number | string | null, currency: string): string {
  const n = typeof value === "number" ? value : toNumber(value);
  if (n === null) return "—";
  const symbol = currency === "TRY" ? "₺" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  const formatted = n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol ? `${symbol}${formatted}` : `${formatted} ${currency}`.trim();
}
