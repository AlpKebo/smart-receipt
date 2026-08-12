# Smart Receipt

Fiş fotoğraflarını yapay zekâ ile okuyup, kullanıcı onayladıktan sonra görselleri Google Drive'a,
bilgileri Google Sheets'e otomatik kaydeden harcama takip uygulaması.

## Akış

```
Fotoğraf yükle / kamerayla çek
  → tarayıcıda küçültme + JPEG'e çevirme
  → /api/analyze  → fal.ai (openrouter/router/vision · anthropic/claude-sonnet-5) → structured JSON
  → düzenlenebilir kartlarda kontrol ve düzeltme
  → /api/receipts → Apps Script Web App
        ├─ görsel → Drive "Smart Receipt Uploads" klasörü → paylaşılabilir URL
        └─ satır  → Google Sheet (11 sütun)
                     └─ Summary sayfası: aylık toplam + kategori pie chart (formül tabanlı, otomatik)
```

## Kurulum

### 1. Google tarafı

`apps-script/KURULUM.md` dosyasındaki adımları uygula: Sheet oluştur, `apps-script/Code.gs`
içeriğini Apps Script'e yapıştır, `SHARED_SECRET` değerini değiştir, `setup()` fonksiyonunu
çalıştır ve web app olarak deploy et.

### 2. Ortam değişkenleri

`.env.example` dosyasını `.env.local` olarak kopyala ve doldur:

| Değişken | Nereden |
|---|---|
| `FAL_KEY` | <https://fal.ai/dashboard/keys> |
| `GOOGLE_APPS_SCRIPT_URL` | Apps Script deploy sonrası çıkan `.../exec` adresi |
| `APPS_SCRIPT_SECRET` | `Code.gs` içindeki `SHARED_SECRET` ile birebir aynı |

`.env*` dosyaları `.gitignore` içinde — API anahtarı asla repoya girmez ve yalnızca sunucu
tarafında (route handler'larda) kullanılır.

### 3. Çalıştır

```bash
npm install
npm run dev
```

## Deploy (Vercel)

1. Repoyu GitHub'a push et.
2. Vercel'de "New Project" → repoyu seç.
3. Environment Variables bölümüne `FAL_KEY`, `GOOGLE_APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET` ekle.
4. Deploy → masaüstü ve mobilde uçtan uca test et.

## Proje yapısı

| Yol | İşi |
|---|---|
| `src/app/page.tsx` | Sunucu bileşeni — geçmiş kayıtları Sheet'ten okuyup arayüze verir |
| `src/components/SmartReceiptApp.tsx` | Ana istemci arayüzü (yükleme, analiz, düzenleme, gönderim) |
| `src/components/ReceiptCard.tsx` | Tek fişin düzenlenebilir kartı |
| `src/components/HistoryPanel.tsx` | Geçmiş kayıt kartları |
| `src/app/api/analyze/route.ts` | Görselleri vision modeline gönderir (FAL_KEY sunucuda kalır) |
| `src/app/api/receipts/route.ts` | Geçmiş okuma (GET) ve Sheet'e yazma (POST) |
| `src/lib/vision.ts` | fal.ai çağrısı, prompt, JSON ayıklama ve normalizasyon |
| `src/lib/sheets.ts` | Apps Script ile konuşan sunucu tarafı yardımcıları |
| `src/lib/image.ts` | Tarayıcıda görsel küçültme/sıkıştırma |
| `src/lib/receipt.ts` | Ortak tipler, kategoriler, sayı/para biçimlendirme |
| `apps-script/Code.gs` | Sheet + Drive otomasyonu, geçmiş API'si, haftalık e-posta (bonus) |

## Notlar

- **Görsel boyutu:** telefon fotoğrafları 5-8 MB olabiliyor; tarayıcıda uzun kenar 1600px'e
  indirilip JPEG'e çevriliyor. Aksi halde base64 şişmesi Vercel'in istek gövdesi sınırını aşıyor.
- **Türkçe fiş formatları:** modelden ISO tarih (`yyyy-mm-dd`) ve nokta ondalıklı sayı isteniyor;
  ayrıca `toNumber()` "1.234,56" gibi değerleri de düzeltiyor.
- **`temperature` gönderilmiyor:** Claude Sonnet 5 varsayılan dışı sampling parametrelerini
  400 ile reddediyor.
- **Uydurma yok:** prompt, fişte olmayan alanların boş/null bırakılmasını şart koşuyor.
- **Grafik:** Summary sayfası formül tabanlı olduğu için yeni satır eklendiğinde aylık toplam ve
  pie chart kendiliğinden güncelleniyor.

## Bonuslar

- Tek fotoğraftaki birden fazla fiş ayrı kayıt olarak algılanır (prompt `receipts` dizisi döndürür).
- `apps-script/Code.gs` içindeki `createWeeklyTrigger()` bir kez çalıştırıldığında her Pazartesi
  09:00'da haftalık harcama özeti e-postası gönderilir.
