"use client";

import Image from "next/image";
import { CATEGORIES, formatAmount, isCategory, toNumber, type Receipt } from "@/lib/receipt";

const CURRENCIES = ["TRY", "USD", "EUR", "GBP"];

const fieldClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-muted";

type Props = {
  receipt: Receipt;
  index: number;
  onChange: (id: string, patch: Partial<Receipt>) => void;
  onRemove: (id: string) => void;
  onZoom: (src: string, alt: string) => void;
  disabled?: boolean;
};

export default function ReceiptCard({
  receipt,
  index,
  onChange,
  onRemove,
  onZoom,
  disabled,
}: Props) {
  const missing = !receipt.merchant || !receipt.date || receipt.total === null;

  /** Zorunlu alan boşsa input'un kendisi işaretlensin, kullanıcı aramasın. */
  const need = (empty: boolean) => (empty ? `${fieldClass} border-danger` : fieldClass);

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
            {index + 1}
          </span>
          <div>
            <p className="text-sm font-semibold">{receipt.merchant || "İsimsiz fiş"}</p>
            <p className="text-xs text-muted">
              {formatAmount(receipt.total, receipt.currency)}
              {receipt.date ? ` · ${receipt.date}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onRemove(receipt.id)}
          disabled={disabled}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-40"
        >
          Sil
        </button>
      </header>

      <div className="grid gap-5 p-4 sm:grid-cols-[180px_1fr]">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onZoom(receipt.previewUrl, receipt.sourceFileName)}
            title="Fişi büyüt"
            className="group relative block aspect-[3/4] w-full overflow-hidden rounded-xl border border-border bg-surface-muted"
          >
            <Image
              src={receipt.previewUrl}
              alt={`${receipt.merchant || "Fiş"} görseli`}
              fill
              unoptimized
              sizes="180px"
              className="object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-[11px] text-white opacity-0 transition group-hover:opacity-100">
              Büyütmek için tıkla
            </span>
          </button>
          <p className="truncate text-xs text-muted" title={receipt.sourceFileName}>
            {receipt.sourceFileName}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor={`merchant-${receipt.id}`}>
              Mağaza / İşletme
            </label>
            <input
              id={`merchant-${receipt.id}`}
              className={need(!receipt.merchant)}
              value={receipt.merchant}
              disabled={disabled}
              onChange={(e) => onChange(receipt.id, { merchant: e.target.value })}
              placeholder="Örn. Migros"
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`date-${receipt.id}`}>
              Tarih
            </label>
            <input
              id={`date-${receipt.id}`}
              type="date"
              className={need(!receipt.date)}
              value={receipt.date}
              disabled={disabled}
              onChange={(e) => onChange(receipt.id, { date: e.target.value })}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`time-${receipt.id}`}>
              Saat
            </label>
            <input
              id={`time-${receipt.id}`}
              type="time"
              className={fieldClass}
              value={receipt.time}
              disabled={disabled}
              onChange={(e) => onChange(receipt.id, { time: e.target.value })}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`total-${receipt.id}`}>
              Toplam Tutar
            </label>
            <input
              id={`total-${receipt.id}`}
              type="number"
              step="0.01"
              inputMode="decimal"
              className={need(receipt.total === null)}
              value={receipt.total ?? ""}
              disabled={disabled}
              onChange={(e) => onChange(receipt.id, { total: toNumber(e.target.value) })}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`currency-${receipt.id}`}>
              Para Birimi
            </label>
            <select
              id={`currency-${receipt.id}`}
              className={fieldClass}
              value={receipt.currency}
              disabled={disabled}
              onChange={(e) => onChange(receipt.id, { currency: e.target.value })}
            >
              {/* AI listede olmayan bir kod döndürürse seçenek kaybolmasın. */}
              {(CURRENCIES.includes(receipt.currency) ? CURRENCIES : [receipt.currency, ...CURRENCIES]).map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ),
              )}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor={`tax-${receipt.id}`}>
              Vergi / KDV
            </label>
            <input
              id={`tax-${receipt.id}`}
              type="number"
              step="0.01"
              inputMode="decimal"
              className={fieldClass}
              value={receipt.tax ?? ""}
              disabled={disabled}
              onChange={(e) => onChange(receipt.id, { tax: toNumber(e.target.value) })}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`category-${receipt.id}`}>
              Kategori
            </label>
            <select
              id={`category-${receipt.id}`}
              className={fieldClass}
              value={receipt.category}
              disabled={disabled}
              onChange={(e) => {
                if (isCategory(e.target.value)) onChange(receipt.id, { category: e.target.value });
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor={`bank-${receipt.id}`}>
              Banka / Kart
            </label>
            <input
              id={`bank-${receipt.id}`}
              className={fieldClass}
              value={receipt.bankName}
              disabled={disabled}
              onChange={(e) => onChange(receipt.id, { bankName: e.target.value })}
              placeholder="Örn. Garanti BBVA — nakit ödemede boş bırak"
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor={`items-${receipt.id}`}>
              Alınan Ürünler <span className="normal-case">(her satıra bir ürün)</span>
            </label>
            <textarea
              id={`items-${receipt.id}`}
              rows={3}
              className={`${fieldClass} resize-y`}
              value={receipt.items.join("\n")}
              disabled={disabled}
              // Satırlar burada temizlenmiyor: boş satırı anında silmek yeni
              // satır yazmayı imkânsız kılıyordu. Temizlik gönderim anında.
              onChange={(e) => onChange(receipt.id, { items: e.target.value.split("\n") })}
              placeholder={"Süt\nEkmek\nElma"}
            />
          </div>

          {missing && (
            <p className="sm:col-span-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              Mağaza adı, tarih ve toplam tutar okunamadı ya da eksik — göndermeden önce doldur.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
