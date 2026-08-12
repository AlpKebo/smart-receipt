"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import HistoryPanel from "@/components/HistoryPanel";
import ReceiptCard from "@/components/ReceiptCard";
import { prepareImage, type PreparedImage } from "@/lib/image";
import { formatAmount, type ExtractedReceipt, type HistoryReceipt, type Receipt } from "@/lib/receipt";

type Status = "idle" | "preparing" | "analyzing" | "sending";

type AnalyzeResponse = {
  ok: boolean;
  error?: string;
  results?: { index: number; receipts: ExtractedReceipt[]; error?: string }[];
};

export default function SmartReceiptApp() {
  const [pending, setPending] = useState<PreparedImage[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragging, setDragging] = useState(false);
  /** Büyütülmüş fiş görseli — alanları düzeltirken fişi okuyabilmek için. */
  const [zoomed, setZoomed] = useState<{ src: string; alt: string } | null>(null);

  const [history, setHistory] = useState<HistoryReceipt[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const busy = status !== "idle";

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/receipts", { cache: "no-store" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Geçmiş kayıtlar alınamadı.");
      setHistory(data.receipts);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Geçmiş kayıtlar bilerek istemci tarafında çekiliyor: Apps Script okuması
  // 6-30 sn sürüyor ve zaman zaman hata veriyor, sayfayı ona kilitlemek yerine
  // iskeleti hemen gösterip veriyi arkadan yüklüyoruz.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory();
  }, [loadHistory]);

  async function handleFiles(fileList: FileList | File[] | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;
    setError(null);
    setNotice(null);
    setStatus("preparing");

    const images: PreparedImage[] = [];
    const failed: string[] = [];

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        failed.push(`${file.name} (görsel değil)`);
        continue;
      }
      try {
        images.push(await prepareImage(file));
      } catch {
        failed.push(file.name);
      }
    }

    setPending((prev) => [...prev, ...images]);
    if (failed.length > 0) setError(`Şu dosyalar okunamadı: ${failed.join(", ")}`);
    setStatus("idle");

    // Aynı dosyayı tekrar seçebilmek için input'u sıfırla.
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  }

  /**
   * Her fotoğraf ayrı istekte gönderiliyor: hepsini tek gövdede yollamak
   * base64 şişmesiyle Vercel'in ~4.5 MB istek sınırını aşıyordu. Ayrıca
   * böylece ilerleme gösterilebiliyor ve biri patlarsa diğerleri etkilenmiyor.
   */
  async function analyze() {
    if (pending.length === 0) return;
    setStatus("analyzing");
    setError(null);
    setNotice(null);
    setProgress({ done: 0, total: pending.length });

    const analyzed: Receipt[] = [];
    const failures: string[] = [];

    const jobs = pending.map(async (source, index) => {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: [source.dataUrl] }),
        });
        const data: AnalyzeResponse = await response.json();
        if (!data.ok) throw new Error(data.error ?? "Analiz başarısız oldu.");

        const result = data.results?.[0];
        if (!result || result.error) throw new Error(result?.error ?? "Sonuç boş döndü.");

        // Bir fotoğrafta birden fazla fiş varsa hepsi ayrı kayıt olur (bonus).
        result.receipts.forEach((extracted, n) => {
          analyzed.push({
            ...extracted,
            id: `${index}-${n}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            imageBase64: source.base64,
            imageMimeType: source.mimeType,
            previewUrl: source.dataUrl,
            sourceFileName: source.fileName,
          });
        });
      } catch {
        failures.push(source.fileName);
      } finally {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    });

    await Promise.all(jobs);

    setReceipts((prev) => [...prev, ...analyzed]);
    // Okunamayan fotoğraflar listede kalsın ki kullanıcı tekrar deneyebilsin.
    setPending((prev) => prev.filter((p) => failures.includes(p.fileName)));

    if (failures.length > 0) {
      setError(`Okunamayan fotoğraflar listede bırakıldı: ${failures.join(", ")}`);
    }
    if (analyzed.length > 0) {
      setNotice(`${analyzed.length} fiş okundu. Bilgileri kontrol edip düzeltebilirsin.`);
    }
    setStatus("idle");
  }

  /**
   * Fişler ikişerli gruplar hâlinde gönderiliyor — görseller base64 olduğu için
   * hepsini tek gövdede yollamak istek boyutu sınırını aşabiliyor. Bir grup
   * başarısız olursa kaydedilenler listeden düşer, kalanlar ekranda kalır.
   */
  async function sendToSheets() {
    if (receipts.length === 0) return;
    setStatus("sending");
    setError(null);
    setNotice(null);
    setProgress({ done: 0, total: receipts.length });

    const CHUNK = 2;
    const queue = [...receipts];
    let saved = 0;
    let failure: string | null = null;

    while (queue.length > 0) {
      const chunk = queue.splice(0, CHUNK);
      try {
        const response = await fetch("/api/receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receipts: chunk.map((r) => ({
              merchant: r.merchant,
              date: r.date,
              time: r.time,
              category: r.category,
              total: r.total,
              currency: r.currency,
              tax: r.tax,
              bankName: r.bankName,
              items: r.items.map((i) => i.trim()).filter(Boolean),
              imageBase64: r.imageBase64,
              imageMimeType: r.imageMimeType,
            })),
          }),
        });
        const data = await response.json();
        if (!data.ok) throw new Error(data.error ?? "Google Sheets'e gönderilemedi.");

        saved += chunk.length;
        const sentIds = new Set(chunk.map((r) => r.id));
        setReceipts((prev) => prev.filter((r) => !sentIds.has(r.id)));
        setProgress((p) => ({ ...p, done: p.done + chunk.length }));
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
        break;
      }
    }

    if (saved > 0) {
      setNotice(`${saved} fiş Google Sheets'e kaydedildi, görselleri Drive'a yüklendi.`);
      void loadHistory();
    }
    if (failure) {
      setError(
        saved > 0
          ? `${failure} — ${saved} fiş kaydedildi, kalanlar ekranda duruyor, tekrar deneyebilirsin.`
          : failure,
      );
    }
    setStatus("idle");
  }

  function updateReceipt(id: string, patch: Partial<Receipt>) {
    setReceipts((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const readyToSend =
    receipts.length > 0 && receipts.every((r) => r.merchant && r.date && r.total !== null);

  // Farklı para birimlerini toplamak yanlış olur; her birini ayrı topluyoruz.
  const totalsByCurrency = receipts.reduce<Record<string, number>>((acc, r) => {
    if (r.total !== null) acc[r.currency] = (acc[r.currency] ?? 0) + r.total;
    return acc;
  }, {});
  const draftTotals = Object.entries(totalsByCurrency)
    .map(([currency, sum]) => formatAmount(sum, currency))
    .join(" · ");

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-10">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Yapay zekâ destekli harcama takibi
        </span>

        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Smart Receipt</h1>

        <p className="mt-3 max-w-2xl leading-relaxed text-muted">
          Fiş fotoğraflarınızı yükleyin; yapay zekâ mağaza adı, tarih, tutar, para birimi, KDV,
          banka ve ürün bilgilerini otomatik olarak okusun. Onayladığınız kayıtlar Google
          Sheets&apos;e satır olarak eklenir, fiş görselleri Google Drive&apos;da saklanır; aylık
          toplamınız ve kategori dağılımınız kendiliğinden güncellenir.
        </p>

        <ol className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { n: "1", t: "Yükle", d: "Bilgisayardan seç, sürükle bırak ya da kamerayla çek." },
            { n: "2", t: "Kontrol Et", d: "Yapay zekânın okuduğu alanları gözden geçir, düzelt." },
            { n: "3", t: "Kaydet", d: "Tek tuşla Google Sheets ve Drive'a aktar." },
          ].map((s) => (
            <li
              key={s.n}
              className="flex gap-3 rounded-xl border border-border bg-surface/70 px-4 py-3 backdrop-blur-sm"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                {s.n}
              </span>
              <span>
                <span className="block text-sm font-semibold">{s.t}</span>
                <span className="block text-xs leading-relaxed text-muted">{s.d}</span>
              </span>
            </li>
          ))}
        </ol>
      </header>

      {(error || notice) && (
        <div
          role="status"
          className={`mb-6 flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${
            error ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"
          }`}
        >
          <span className="flex-1">{error ?? notice}</span>
          <button
            type="button"
            aria-label="Mesajı kapat"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
            className="shrink-0 rounded px-1 text-base leading-none opacity-70 transition hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* 1 — Yükleme */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) void handleFiles(Array.from(e.dataTransfer.files));
        }}
        className={`mb-10 rounded-2xl border p-5 shadow-sm transition ${
          dragging ? "border-accent bg-accent-soft" : "border-border bg-surface"
        }`}
      >
        <h2 className="text-lg font-semibold">1. Fiş Ekle</h2>
        <p className="mt-1 text-sm text-muted">
          Birden fazla fotoğraf seçebilir ya da buraya sürükleyip bırakabilirsin. Her fotoğrafta tek
          fiş olması önerilir.
        </p>

        {pending.length === 0 && status !== "preparing" && (
          <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="mx-auto h-9 w-9 text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 16V4m0 0L8 8m4-4 4 4" />
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
            <p className="mt-3 text-sm font-medium">Fotoğrafları buraya sürükle</p>
            <p className="mt-1 text-xs text-muted">
              ya da aşağıdaki butonları kullan · JPG, PNG · aynı anda birden fazla
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Fotoğraf Yükle
          </button>
          <button
            type="button"
            onClick={() => cameraInput.current?.click()}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-50"
          >
            Kamerayla Çek
          </button>

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </div>

        {status === "preparing" && <p className="mt-3 text-sm text-muted">Fotoğraflar hazırlanıyor…</p>}

        {pending.length > 0 && (
          <>
            <ul className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-5">
              {pending.map((p, i) => (
                <li key={`${p.fileName}-${i}`} className="group relative">
                  <button
                    type="button"
                    onClick={() => setZoomed({ src: p.dataUrl, alt: p.fileName })}
                    title="Büyütmek için tıkla"
                    className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl border border-border bg-surface-muted"
                  >
                    <Image
                      src={p.dataUrl}
                      alt={`${p.fileName} önizlemesi`}
                      fill
                      unoptimized
                      sizes="(max-width: 640px) 33vw, 20vw"
                      className="object-cover transition group-hover:scale-105"
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={`${p.fileName} fotoğrafını kaldır`}
                    onClick={() => setPending((prev) => prev.filter((_, n) => n !== i))}
                    disabled={busy}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-sm text-white transition hover:bg-black/80 disabled:opacity-40"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void analyze()}
                disabled={busy}
                className="w-full rounded-lg bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50 sm:w-auto sm:px-6"
              >
                {status === "analyzing"
                  ? `Analiz ediliyor… ${progress.done}/${progress.total}`
                  : `Fişleri Analiz Et (${pending.length})`}
              </button>
              {!busy && (
                <button
                  type="button"
                  onClick={() => setPending([])}
                  className="text-sm font-medium text-muted underline underline-offset-4 transition hover:text-foreground"
                >
                  Tümünü kaldır
                </button>
              )}
            </div>

            {status === "analyzing" && (
              <div
                className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
                role="progressbar"
                aria-valuenow={progress.done}
                aria-valuemin={0}
                aria-valuemax={progress.total}
              >
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
                />
              </div>
            )}
          </>
        )}
      </section>

      {/* 2 — Düzenleme */}
      {receipts.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">2. Kontrol Et ve Düzelt</h2>
              <p className="text-sm text-muted">
                {receipts.length} fiş · toplam{" "}
                <strong className="text-foreground">{draftTotals || "—"}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => void sendToSheets()}
              disabled={busy || !readyToSend}
              title={readyToSend ? undefined : "Her fişte mağaza adı, tarih ve toplam tutar dolu olmalı."}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {status === "sending"
                ? `Gönderiliyor… ${progress.done}/${progress.total}`
                : "Google Sheets'e Gönder"}
            </button>
          </div>

          <div className="space-y-4">
            {receipts.map((r, i) => (
              <ReceiptCard
                key={r.id}
                receipt={r}
                index={i}
                onChange={updateReceipt}
                onRemove={(id) => setReceipts((prev) => prev.filter((x) => x.id !== id))}
                onZoom={(src, alt) => setZoomed({ src, alt })}
                disabled={busy}
              />
            ))}
          </div>
        </section>
      )}

      {/* 3 — Geçmiş */}
      <HistoryPanel
        receipts={history}
        loading={historyLoading}
        error={historyError}
        onRefresh={() => void loadHistory()}
      />

      {/* Mobilde gönder butonu ekranın altında sabit dursun; uzun listede kaybolmasın. */}
      {receipts.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:hidden">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">
              <span className="block text-xs text-muted">{receipts.length} fiş</span>
              <strong>{draftTotals || "—"}</strong>
            </span>
            <button
              type="button"
              onClick={() => void sendToSheets()}
              disabled={busy || !readyToSend}
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
            >
              {status === "sending" ? `${progress.done}/${progress.total}` : "Sheets'e Gönder"}
            </button>
          </div>
        </div>
      )}
      {receipts.length > 0 && <div className="h-20 sm:hidden" aria-hidden />}

      {/* Görsel büyütme */}
      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${zoomed.alt} — büyütülmüş görünüm`}
          onClick={() => setZoomed(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <button
            type="button"
            aria-label="Kapat"
            onClick={() => setZoomed(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white transition hover:bg-white/20"
          >
            Kapat ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomed.src}
            alt={zoomed.alt}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </main>
  );
}
