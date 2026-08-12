# Adım 1 — Google tarafı kurulumu

Bu adımları senin yapman gerekiyor (Google hesabına ben erişemiyorum). Toplam ~10 dakika.
Sonunda bana **Web App URL**'sini ve seçtiğin **secret**'ı vereceksin.

---

## 1. Google Sheet oluştur

1. <https://sheets.new> adresini aç → boş bir tablo açılır.
2. Sol üstteki isme tıklayıp adını **Smart Receipt** yap.

## 2. Apps Script projesini aç

1. Sheet'te üst menüden **Uzantılar → Apps Script**.
2. Açılan editörde `Code.gs` dosyasındaki hazır `function myFunction() {}` kodunu **tamamen sil**.
3. Bu klasördeki `apps-script/Code.gs` dosyasının **tüm içeriğini** kopyalayıp yapıştır.
4. Sol üstteki proje adını **Smart Receipt Backend** yap.

## 3. Secret'ı değiştir

Kodun en üstündeki satırı bul:

```js
const SHARED_SECRET = 'BUNU-DEGISTIR-uzun-rastgele-bir-metin-yaz';
```

Buradaki metni uzun ve rastgele bir şeyle değiştir (örn. 30+ karakter, harf+rakam karışık).
**Bu değeri bir yere not et** — birazdan `.env` dosyasına da yazacağız.

> Neden? Web app URL'si "Anyone" erişimine açılacak. Secret olmadan URL'yi ele geçiren
> herkes senin Sheet'ine satır yazabilir veya kayıtlarını okuyabilir.

Sonra **Ctrl+S** ile kaydet.

## 4. `setup()` fonksiyonunu çalıştır

1. Editörün üstündeki fonksiyon açılır listesinden **setup** seç.
2. **Run** (▶) butonuna bas.
3. İlk çalıştırmada izin isteyecek:
   - **Review permissions** → Google hesabını seç
   - "Google hasn't verified this app" uyarısında → **Advanced** → **Go to Smart Receipt Backend (unsafe)**
   - **Allow**
   
   (Bu uyarı normal: kendi yazdığın, Google tarafından incelenmemiş bir script olduğu için çıkıyor.)

Çalışma bitince Sheet'e dönüp kontrol et:

- **Receipts** sayfası → 11 sütun başlığı, dondurulmuş ilk satır, Category sütununda açılır liste
- **Summary** sayfası → aylık toplam, kategori tablosu, **pie chart**, son 12 ay tablosu
- Google Drive'ında **Smart Receipt Uploads** klasörü oluşmuş olmalı

## 5. Web App olarak deploy et

1. Apps Script editöründe sağ üstte **Deploy → New deployment**.
2. Sol üstteki dişli (**Select type**) → **Web app**.
3. Ayarlar:

   | Alan | Değer |
   |---|---|
   | Description | `v1` |
   | Execute as | **Me (senin e-postan)** |
   | Who has access | **Anyone** |

   > ⚠️ "Anyone with Google account" **değil**, düz **Anyone** olmalı. Aksi halde
   > uygulamamız 401/yönlendirme alır.

4. **Deploy** → izinleri onayla.
5. Çıkan **Web app URL**'sini kopyala. Şuna benzer:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

## 6. Test et

Tarayıcında şu adresi aç (`SENIN_URL` ve `SENIN_SECRET` yerine kendi değerlerin):

```
SENIN_URL?action=ping&secret=SENIN_SECRET
```

Görmen gereken:

```json
{"ok":true,"message":"Smart Receipt Apps Script çalışıyor"}
```

`{"ok":false,"error":"Yetkisiz istek"}` görürsen → secret uyuşmuyor.
Giriş sayfasına yönlendiriliyorsan → "Who has access" ayarı **Anyone** değil.

---

## Bana vermen gerekenler

Bu adımlar bitince şunları paylaş, `.env.local` dosyasını ona göre kuracağım:

1. **Web App URL** (`.../exec` ile biten)
2. **Secret** (4. adımda yazdığın metin)
3. **fal.ai API key** (<https://fal.ai/dashboard/keys> → yoksa yeni oluştur)

> Bu üçü de `.env.local` içinde kalacak, `.gitignore`'a eklenecek ve GitHub'a **asla**
> gitmeyecek. Vercel'e ayrıca environment variable olarak gireceğiz.

---

## Sonradan kod değiştirirsek

Apps Script kodunu güncellersek, değişikliğin canlıya çıkması için:
**Deploy → Manage deployments → (kalem ikonu) → Version: New version → Deploy**

Yeni deployment oluşturursan URL değişir; "Manage deployments" üzerinden güncellersen
URL aynı kalır — bunu tercih et.
