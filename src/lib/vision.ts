import { fal } from "@fal-ai/client";
import { CATEGORIES, isCategory, toNumber, type ExtractedReceipt } from "./receipt";

/** Proje dokümanının şart koştuğu endpoint ve model. */
const FAL_ENDPOINT = "openrouter/router/vision";
const VISION_MODEL = "anthropic/claude-sonnet-5";

const SYSTEM_PROMPT = `Sen fiş ve fatura görsellerinden veri çıkaran bir belge okuma sistemisin.
Yalnızca geçerli JSON döndür. Markdown kod bloğu, açıklama veya ek metin yazma.
Fişte açıkça yazmayan hiçbir bilgiyi UYDURMA — okuyamadığın alanı null (metin alanları için "") bırak.`;

const USER_PROMPT = `Bu görseldeki fiş(ler)i analiz et ve şu JSON şemasına birebir uy:

{
  "receipts": [
    {
      "merchant": "işletme veya mağaza adı",
      "date": "yyyy-mm-dd",
      "time": "HH:mm",
      "category": ${CATEGORIES.map((c) => `"${c}"`).join(" | ")},
      "total": 842.50,
      "currency": "TRY",
      "tax": 76.59,
      "bankName": "kart/banka adı",
      "items": ["ürün 1", "ürün 2"]
    }
  ]
}

Kurallar:
- Görselde birden fazla ayrı fiş varsa her birini "receipts" dizisinde ayrı bir nesne olarak döndür. Tek fiş varsa dizide tek eleman olsun.
- "total" ve "tax" sayı olmalı (metin değil, para birimi simgesi olmadan). Okunamıyorsa null.
- "date" mutlaka yyyy-mm-dd formatında olsun. Fişte yıl yoksa null bırak.
- "time" 24 saat formatında HH:mm olsun. Yoksa "".
- "currency" ISO kodu olsun: TRY, USD, EUR vb. Fişte ₺ veya TL geçiyorsa TRY.
- "category" yukarıdaki listeden tam olarak biri olmalı. Emin değilsen "Diğer".
- "bankName" fişte yazan banka/kart kuruluşu (örn. "Garanti BBVA", "Ziraat"). Nakit ödemede "".
- "items" fişteki ürün satırlarının adları; fiyatları dahil etme. Ürün listesi okunamıyorsa [].`;

/** ```json ... ``` sarmalı veya yanına yazılmış açıklamalardan JSON'u ayıklar. */
function extractJson(raw: string): unknown {
  const text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  try {
    return JSON.parse(candidate);
  } catch {
    // Model metin arasına JSON gömdüyse ilk { ... } bloğunu yakala.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model geçerli JSON döndürmedi.");
  }
}

function normalizeReceipt(raw: Record<string, unknown>): ExtractedReceipt {
  const items = Array.isArray(raw.items)
    ? raw.items.map((i) => String(i).trim()).filter(Boolean)
    : [];

  const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : "";
  const time = typeof raw.time === "string" && /^\d{1,2}:\d{2}/.test(raw.time) ? raw.time.slice(0, 5) : "";

  return {
    merchant: typeof raw.merchant === "string" ? raw.merchant.trim() : "",
    date,
    time,
    category: isCategory(raw.category) ? raw.category : "Diğer",
    total: toNumber(raw.total),
    currency: typeof raw.currency === "string" && raw.currency.trim() ? raw.currency.trim().toUpperCase() : "TRY",
    tax: toNumber(raw.tax),
    bankName: typeof raw.bankName === "string" ? raw.bankName.trim() : "",
    items,
  };
}

/**
 * Tek bir görseli analiz eder. Görselde birden fazla fiş varsa birden fazla kayıt döner.
 * @param dataUrl "data:image/jpeg;base64,..." biçiminde görsel
 */
export async function analyzeReceiptImage(dataUrl: string): Promise<ExtractedReceipt[]> {
  if (!process.env.FAL_KEY) {
    throw new Error("FAL_KEY tanımlı değil. .env.local dosyasını kontrol et.");
  }

  fal.config({ credentials: process.env.FAL_KEY });

  const result = await fal.subscribe(FAL_ENDPOINT, {
    input: {
      model: VISION_MODEL,
      system_prompt: SYSTEM_PROMPT,
      prompt: USER_PROMPT,
      image_urls: [dataUrl],
      // temperature gönderilmiyor: Claude Sonnet 5 varsayılan dışı sampling
      // parametrelerini (temperature/top_p/top_k) 400 ile reddediyor.
      max_tokens: 2048,
    },
  });

  const output = (result.data as { output?: string } | undefined)?.output;
  if (!output) throw new Error("Vision modelinden boş yanıt geldi.");

  const parsed = extractJson(output) as { receipts?: unknown } | unknown[];

  // Model bazen doğrudan dizi ya da tek nesne döndürebiliyor; üçünü de kabul et.
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { receipts?: unknown }).receipts)
      ? ((parsed as { receipts: unknown[] }).receipts)
      : [parsed];

  const receipts = list
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map(normalizeReceipt);

  return receipts.length > 0 ? receipts : [normalizeReceipt({})];
}
