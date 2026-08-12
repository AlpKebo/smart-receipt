"use client";

import Image from "next/image";
import { formatAmount, type HistoryReceipt } from "@/lib/receipt";

type Props = {
  receipts: HistoryReceipt[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

export default function HistoryPanel({ receipts, loading, error, onRefresh }: Props) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Geçmiş Kayıtlar</h2>
          <p className="text-sm text-muted">Google Sheet&apos;e kaydedilmiş fişler, en yeniden eskiye.</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-surface-muted disabled:opacity-50"
        >
          {loading ? "Yükleniyor…" : "Yenile"}
        </button>
      </div>

      {error && (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error} — &quot;Yenile&quot; ile tekrar deneyebilirsin.
        </p>
      )}

      {loading && receipts.length === 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-border bg-surface p-3">
              <div className="h-24 w-20 shrink-0 animate-pulse rounded-lg bg-surface-muted" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-4 w-2/3 animate-pulse rounded bg-surface-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-surface-muted" />
                <div className="h-5 w-1/3 animate-pulse rounded bg-surface-muted" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {!error && !loading && receipts.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          Henüz kayıt yok. İlk fişini yükleyip Google Sheets&apos;e gönder.
        </p>
      )}

      {receipts.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {receipts.map((r, i) => (
            <li
              key={`${r.uploadedAt}-${i}`}
              className="flex gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm"
            >
              <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                {r.thumbnailUrl ? (
                  <Image
                    src={r.thumbnailUrl}
                    alt={`${r.merchant} fişi`}
                    fill
                    unoptimized
                    sizes="80px"
                    className="object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-muted">
                    görsel yok
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.merchant || "—"}</p>
                <p className="text-sm text-muted">{r.date || "—"}</p>
                <span className="mt-1 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                  {r.category || "Diğer"}
                </span>
                <p className="mt-1 text-base font-semibold">{formatAmount(r.total, r.currency)}</p>
                {r.imageUrl && (
                  <a
                    href={r.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent underline underline-offset-2"
                  >
                    Fişi aç
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
