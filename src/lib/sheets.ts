import "server-only";
import type { HistoryReceipt } from "./receipt";

/** Apps Script web app ile konuşan sunucu tarafı yardımcıları. */

function config() {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) {
    throw new Error(
      "GOOGLE_APPS_SCRIPT_URL veya APPS_SCRIPT_SECRET tanımlı değil. .env.local dosyasını kontrol et.",
    );
  }
  return { url, secret };
}

/**
 * Apps Script "Anyone" erişimiyle deploy edildiğinde 302 ile
 * script.googleusercontent.com adresine yönlendiriyor — fetch bunu takip eder.
 * Gövde JSON değilse (giriş sayfası ya da hata sayfası HTML'i) anlaşılır hata üret.
 */
async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      response.status === 404
        ? "Apps Script geçici olarak yanıt vermedi (404). Birazdan tekrar dene."
        : "Apps Script JSON yerine HTML döndürdü. Deployment ayarında 'Who has access' değeri 'Anyone' olmalı.",
    );
  }
}

/**
 * Apps Script yönlendirmesi ölçümlerde ~6 istekte 1 kez 404 HTML dönüyor ve
 * bu durum bir dakikadan uzun sürebiliyor. Uzun uzun beklemek yerine bir kez
 * hızlıca tekrar deniyoruz; olmazsa hatayı gösterip kullanıcıya bırakıyoruz.
 */
async function fetchJsonWithRetry(url: URL, attempts = 2) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      return await readJson(response);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastError;
}

/** Google Sheet'teki geçmiş kayıtlar, en yeniden eskiye. */
export async function fetchHistory(limit = 50): Promise<HistoryReceipt[]> {
  const { url, secret } = config();

  const target = new URL(url);
  target.searchParams.set("action", "history");
  target.searchParams.set("secret", secret);
  target.searchParams.set("limit", String(limit));

  const data = await fetchJsonWithRetry(target);
  if (!data.ok) throw new Error(data.error ?? "Geçmiş kayıtlar alınamadı.");

  return (data.receipts ?? []) as HistoryReceipt[];
}

/** Onaylanan fişleri Drive'a + Sheet'e yazar, kaydedilen satır sayısını döner. */
export async function saveReceipts(receipts: unknown[]): Promise<number> {
  const { url, secret } = config();

  const response = await fetch(url, {
    method: "POST",
    // Apps Script text/plain gövdeyi CORS preflight olmadan kabul eder.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret, receipts }),
    redirect: "follow",
  });

  // Yazma isteği tekrar denenmiyor: Apps Script satırı yazmış ama yanıt
  // sayfası düşmüş olabilir; tekrar denemek fişi ikinci kez kaydeder.
  let data;
  try {
    data = await readJson(response);
  } catch {
    throw new Error(
      "Apps Script yanıtı okunamadı. Kayıt yazılmış olabilir — tekrar göndermeden önce Google Sheet'i kontrol et.",
    );
  }
  if (!data.ok) throw new Error(data.error ?? "Google Sheets'e yazılamadı.");

  return typeof data.saved === "number" ? data.saved : receipts.length;
}
