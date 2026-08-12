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

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setNotice(null);
    setStatus("preparing");

    const images: PreparedImage[] = [];
    const failed: string[] = [];

    for (const file of Array.from(fileList)) {
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

  async function analyze() {
    if (pending.length === 0) return;
    setStatus("analyzing");
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: pending.map((p) => p.dataUrl) }),
      });
      const data: AnalyzeResponse = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Analiz başarısız oldu.");

      const analyzed: Receipt[] = [];
      const failures: string[] = [];

      for (const result of data.results ?? []) {
        const source = pending[result.index];
        if (!source) continue;
        if (result.error) {
          failures.push(source.fileName);
          continue;
        }
        // Bir fotoğrafta birden fazla fiş varsa hepsi ayrı kayıt olur (bonus).
        result.receipts.forEach((extracted, n) => {
          analyzed.push({
            ...extracted,
            id: `${result.index}-${n}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            imageBase64: source.base64,
            imageMimeType: source.mimeType,
            previewUrl: source.dataUrl,
            sourceFileName: source.fileName,
          });
        });
      }

      setReceipts((prev) => [...prev, ...analyzed]);
      setPending([]);

      if (failures.length > 0) {
        setError(`Analiz edilemeyen fotoğraflar: ${failures.join(", ")}`);
      }
      if (analyzed.length > 0) {
        setNotice(`${analyzed.length} fiş okundu. Bilgileri kontrol edip düzeltebilirsin.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus("idle");
    }
  }

  async function sendToSheets() {
    if (receipts.length === 0) return;
    setStatus("sending");
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receipts: receipts.map((r) => ({
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

      setNotice(`${data.saved} fiş Google Sheets'e kaydedildi ve görselleri Drive'a yüklendi.`);
      setReceipts([]);
      void loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus("idle");
    }
  }

  function updateReceipt(id: string, patch: Partial<Receipt>) {
    setReceipts((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const readyToSend =
    receipts.length > 0 && receipts.every((r) => r.merchant && r.date && r.total !== null);

  const draftTotal = receipts.reduce((sum, r) => sum + (r.total ?? 0), 0);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Smart Receipt</h1>
        <p className="mt-2 text-muted">
          Fiş fotoğraflarını yükle, yapay zekâ bilgileri okusun, kontrol et ve tek tuşla Google
          Sheets&apos;e gönder.
        </p>
      </header>

      {(error || notice) && (
        <div
          role="status"
          className={`mb-6 rounded-xl px-4 py-3 text-sm ${
            error ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"
          }`}
        >
          {error ?? notice}
        </div>
      )}

      {/* 1 — Yükleme */}
      <section className="mb-10 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold">1. Fiş Ekle</h2>
        <p className="mt-1 text-sm text-muted">
          Birden fazla fotoğraf seçebilirsin. Her fotoğrafta tek fiş olması önerilir.
        </p>

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
                  <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-surface-muted">
                    <Image
                      src={p.dataUrl}
                      alt={`${p.fileName} önizlemesi`}
                      fill
                      unoptimized
                      sizes="(max-width: 640px) 33vw, 20vw"
                      className="object-cover"
                    />
                  </div>
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

            <button
              type="button"
              onClick={() => void analyze()}
              disabled={busy}
              className="mt-5 w-full rounded-lg bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50 sm:w-auto sm:px-6"
            >
              {status === "analyzing"
                ? "Analiz ediliyor… (bu 20-40 saniye sürebilir)"
                : `Fişleri Analiz Et (${pending.length})`}
            </button>
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
                <strong className="text-foreground">
                  {formatAmount(draftTotal, receipts[0]?.currency ?? "TRY")}
                </strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => void sendToSheets()}
              disabled={busy || !readyToSend}
              title={readyToSend ? undefined : "Her fişte mağaza adı, tarih ve toplam tutar dolu olmalı."}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {status === "sending" ? "Gönderiliyor…" : "Google Sheets'e Gönder"}
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
    </main>
  );
}
