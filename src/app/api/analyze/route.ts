import { NextResponse } from "next/server";
import { analyzeReceiptImage } from "@/lib/vision";

export const runtime = "nodejs";
/** Vision çağrısı 1-2 dakika sürebiliyor (Vercel Hobby planında üst sınır 60sn). */
export const maxDuration = 300;

type Body = { images?: unknown };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const images = Array.isArray(body.images) ? body.images.filter((i) => typeof i === "string") : [];
  if (images.length === 0) {
    return NextResponse.json({ ok: false, error: "Analiz edilecek görsel yok." }, { status: 400 });
  }
  if (images.length > 10) {
    return NextResponse.json(
      { ok: false, error: "Tek seferde en fazla 10 fiş analiz edilebilir." },
      { status: 400 },
    );
  }

  // Her görsel bağımsız — biri patlarsa diğerleri yine de sonuç dönsün.
  const results = await Promise.all(
    images.map(async (dataUrl, index) => {
      try {
        return { index, receipts: await analyzeReceiptImage(dataUrl as string) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[analyze] görsel ${index} başarısız:`, message);
        return { index, receipts: [], error: message };
      }
    }),
  );

  return NextResponse.json({ ok: true, results });
}
