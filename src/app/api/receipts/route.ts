import { NextResponse } from "next/server";
import { fetchHistory, saveReceipts } from "@/lib/sheets";

export const runtime = "nodejs";
export const maxDuration = 120;

/** GET /api/receipts — geçmiş kayıtlar (istemcideki "Yenile" butonu için). */
export async function GET(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit")) || 50;
    const receipts = await fetchHistory(limit);
    return NextResponse.json({ ok: true, receipts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[receipts:GET]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

/** POST /api/receipts — onaylanan fişleri Drive'a + Sheet'e yazar. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const receipts = Array.isArray(body?.receipts) ? body.receipts : [];
    if (receipts.length === 0) {
      return NextResponse.json({ ok: false, error: "Gönderilecek fiş yok." }, { status: 400 });
    }

    const saved = await saveReceipts(receipts);
    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[receipts:POST]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
