/**
 * Smart Receipt — Google Apps Script backend
 *
 * Görevleri:
 *   1) setup()      → Receipts + Summary sayfalarını, formülleri, pie chart'ı ve Drive klasörünü kurar
 *   2) doPost(e)    → Web uygulamasından gelen fişleri Drive'a + Sheet'e yazar
 *   3) doGet(e)     → Geçmiş kayıtları JSON olarak döndürür
 *   4) weeklySummaryEmail() → (Bonus) haftalık harcama özetini e-posta ile gönderir
 *
 * Bu dosya Google Sheet'e BAĞLI (container-bound) bir Apps Script projesine yapıştırılmalıdır:
 *   Sheet → Uzantılar → Apps Script
 */

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------

/** Web app URL'si herkese açık olduğu için basit bir paylaşılan anahtar kullanıyoruz.
 *  Aşağıdaki değeri uzun ve rastgele bir metinle DEĞİŞTİR, aynısını .env içine yaz. */
const SHARED_SECRET = 'BURAYA-UZUN-RASTGELE-BIR-METIN-YAZ';

const SHEET_NAME = 'Receipts';
const SUMMARY_SHEET_NAME = 'Summary';
const DRIVE_FOLDER_NAME = 'Smart Receipt Uploads';

/** Sheet sütunları — proje dokümanındaki 11 sütun, bu sırayla. */
const HEADERS = [
  'Merchant',
  'Date',
  'Time',
  'Category',
  'Total',
  'Currency',
  'Tax / VAT',
  'Bank Name',
  'Items',
  'Receipt Image URL',
  'Uploaded At',
];

/** Harcama kategorileri — web uygulamasındaki liste ile birebir aynı olmalı. */
const CATEGORIES = [
  'Market',
  'Yemek',
  'Ulaşım',
  'Alışveriş',
  'Sağlık',
  'Eğitim',
  'Eğlence',
  'Fatura',
  'Diğer',
];

/** Formüllerin tarayacağı satır aralığı. Fiş sayın buna yaklaşırsa büyüt. */
const FORMULA_LAST_ROW = 2000;

// ---------------------------------------------------------------------------
// 1) Kurulum — bu fonksiyonu Apps Script editöründen bir kez elle çalıştır
// ---------------------------------------------------------------------------

function setup() {
  const ss = SpreadsheetApp.getActive();
  setupReceiptsSheet_(ss);
  setupSummarySheet_(ss);
  const folder = getUploadFolder_();

  SpreadsheetApp.getActive().toast('Kurulum tamamlandı. Drive klasörü: ' + folder.getName(), 'Smart Receipt', 8);
  Logger.log('Receipts + Summary hazır. Drive klasörü: %s (%s)', folder.getName(), folder.getUrl());
}

function setupReceiptsSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    // İlk sayfa hâlâ boş "Sayfa1" ise onu yeniden adlandır, değilse yeni sayfa aç.
    const first = ss.getSheets()[0];
    const firstIsEmpty = ss.getSheets().length === 1 && first.getLastRow() === 0;
    sheet = firstIsEmpty ? first.setName(SHEET_NAME) : ss.insertSheet(SHEET_NAME, 0);
  }

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);

  const tz = Session.getScriptTimeZone();
  sheet.getRange(2, 2, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');       // Date
  sheet.getRange(2, 3, sheet.getMaxRows() - 1, 1).setNumberFormat('@');                // Time (metin)
  sheet.getRange(2, 5, sheet.getMaxRows() - 1, 1).setNumberFormat('#,##0.00');         // Total
  sheet.getRange(2, 7, sheet.getMaxRows() - 1, 1).setNumberFormat('#,##0.00');         // Tax
  sheet.getRange(2, 11, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');// Uploaded At

  // Kategori sütununa açılır liste — Sheet üzerinden elle düzeltme yaparken de tutarlı kalsın.
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CATEGORIES, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, 4, sheet.getMaxRows() - 1, 1).setDataValidation(rule);

  const widths = [180, 100, 70, 110, 90, 80, 90, 140, 320, 260, 150];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  Logger.log('Receipts sayfası hazır (timezone: %s)', tz);
}

/**
 * Formül argüman ayracını tespit eder.
 * Türkçe (ve çoğu Avrupa) yerelinde Sheets "," yerine ";" bekler; virgüllü
 * formül #ERROR! verir. Yerel listesi tutmak yerine tabloya bir deneme
 * formülü yazıp sonucuna bakıyoruz.
 */
function detectArgSeparator_(sheet) {
  const probe = sheet.getRange(sheet.getMaxRows(), sheet.getMaxColumns());
  probe.setFormula('=SUM(1,1)');
  SpreadsheetApp.flush();
  const worked = probe.getValue() === 2;
  probe.clear();
  return worked ? ',' : ';';
}

function setupSummarySheet_(ss) {
  let sheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SUMMARY_SHEET_NAME);

  // Eski grafikleri temizle ki setup() tekrar çalıştırıldığında grafik çoğalmasın.
  sheet.getCharts().forEach((c) => sheet.removeChart(c));
  sheet.clear();

  const R = `Receipts!$B$2:$B$${FORMULA_LAST_ROW}`;   // Date
  const C = `Receipts!$D$2:$D$${FORMULA_LAST_ROW}`;   // Category
  const T = `Receipts!$E$2:$E$${FORMULA_LAST_ROW}`;   // Total
  const S = detectArgSeparator_(sheet);               // "," veya ";"

  sheet.getRange('A1').setValue('Ay (yyyy-mm)').setFontWeight('bold');
  sheet.getRange('B1').setFormula(`=TEXT(TODAY()${S}"yyyy-mm")`).setNumberFormat('@');
  sheet.getRange('C1').setValue('← bu hücreyi değiştirerek başka bir aya bakabilirsin').setFontColor('#888888');

  sheet.getRange('A2').setValue('Aylık Toplam').setFontWeight('bold');
  sheet.getRange('B2')
    .setFormula(`=SUMPRODUCT((TEXT(${R}${S}"yyyy-mm")=$B$1)*${T})`)
    .setNumberFormat('#,##0.00')
    .setFontSize(14)
    .setFontWeight('bold');

  sheet.getRange('A3').setValue('Fiş Sayısı').setFontWeight('bold');
  sheet.getRange('B3').setFormula(`=SUMPRODUCT((TEXT(${R}${S}"yyyy-mm")=$B$1)*1)`);

  // Kategori dağılımı — pie chart bu aralıktan beslenir.
  sheet.getRange('A5:B5').setValues([['Kategori', 'Toplam']]).setFontWeight('bold');
  CATEGORIES.forEach((cat, i) => {
    const row = 6 + i;
    sheet.getRange(row, 1).setValue(cat);
    sheet.getRange(row, 2)
      .setFormula(`=SUMPRODUCT((TEXT(${R}${S}"yyyy-mm")=$B$1)*(${C}=$A${row})*${T})`)
      .setNumberFormat('#,##0.00');
  });

  // Son 12 ayın toplamı — trend takibi için.
  const lastRow = 5 + CATEGORIES.length;
  sheet.getRange('D5:E5').setValues([['Ay', 'Toplam']]).setFontWeight('bold');
  for (let i = 0; i < 12; i++) {
    const row = 6 + i;
    sheet.getRange(row, 4)
      .setFormula(`=TEXT(EOMONTH(TODAY()${S}-${i})${S}"yyyy-mm")`)
      .setNumberFormat('@');
    sheet.getRange(row, 5)
      .setFormula(`=SUMPRODUCT((TEXT(${R}${S}"yyyy-mm")=$D${row})*${T})`)
      .setNumberFormat('#,##0.00');
  }

  const pie = sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange(5, 1, CATEGORIES.length + 1, 2))
    .setPosition(2, 7, 0, 0)
    .setOption('title', 'Kategori Dağılımı')
    .setOption('pieSliceText', 'percentage')
    .setOption('width', 460)
    .setOption('height', 320)
    .build();
  sheet.insertChart(pie);

  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 320);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 120);

  Logger.log('Summary sayfası hazır (son veri satırı: %s)', lastRow);
}

// ---------------------------------------------------------------------------
// 2) doPost — web uygulamasından gelen fişleri kaydeder
// ---------------------------------------------------------------------------

/**
 * Beklenen gövde:
 * {
 *   "secret": "...",
 *   "receipts": [{
 *     "merchant": "Migros", "date": "2026-08-06", "time": "15:42",
 *     "category": "Market", "total": 842.5, "currency": "TRY",
 *     "tax": 76.59, "bankName": "Garanti BBVA", "items": ["Milk","Bread"],
 *     "imageBase64": "...", "imageMimeType": "image/jpeg"
 *   }]
 * }
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'Boş istek gövdesi' });
    }

    const body = JSON.parse(e.postData.contents);
    if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: 'Yetkisiz istek' });
    }

    const receipts = Array.isArray(body.receipts) ? body.receipts : [];
    if (receipts.length === 0) {
      return json_({ ok: false, error: 'receipts listesi boş' });
    }

    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sheet) return json_({ ok: false, error: SHEET_NAME + ' sayfası yok. Önce setup() çalıştır.' });

    const folder = getUploadFolder_();
    const uploadedAt = new Date();
    const saved = [];

    receipts.forEach((r, index) => {
      let imageUrl = r.imageUrl || '';
      if (!imageUrl && r.imageBase64) {
        imageUrl = saveImageToDrive_(folder, r, index, uploadedAt);
      }

      sheet.appendRow([
        r.merchant || '',
        parseDate_(r.date),
        r.time || '',
        CATEGORIES.indexOf(r.category) >= 0 ? r.category : 'Diğer',
        toNumber_(r.total),
        r.currency || '',
        toNumber_(r.tax),
        r.bankName || '',
        Array.isArray(r.items) ? r.items.join(', ') : (r.items || ''),
        imageUrl,
        uploadedAt,
      ]);

      saved.push({ merchant: r.merchant || '', imageUrl: imageUrl });
    });

    SpreadsheetApp.flush();
    // Geçmiş önbelleği artık bayat; sürümü artırarak geçersiz kıl.
    bumpDataVersion_();

    return json_({ ok: true, saved: saved.length, rows: saved });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** Base64 görseli Drive klasörüne yazar ve görüntülenebilir URL döndürür. */
function saveImageToDrive_(folder, receipt, index, uploadedAt) {
  const mime = receipt.imageMimeType || 'image/jpeg';
  // "data:image/jpeg;base64,...." biçiminde geldiyse başlığı at.
  const raw = String(receipt.imageBase64).replace(/^data:[^;]+;base64,/, '');
  const ext = mime.indexOf('png') >= 0 ? 'png' : mime.indexOf('webp') >= 0 ? 'webp' : 'jpg';

  const stamp = Utilities.formatDate(uploadedAt, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const safeMerchant = String(receipt.merchant || 'receipt').replace(/[^\wğüşıöçĞÜŞİÖÇ -]/g, '').trim() || 'receipt';
  const name = `${stamp}-${index + 1}-${safeMerchant}.${ext}`;

  const blob = Utilities.newBlob(Utilities.base64Decode(raw), mime, name);
  const file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    Logger.log('Paylaşım ayarlanamadı (%s): %s', name, err);
  }
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

/** "Smart Receipt Uploads" klasörünü bulur, yoksa oluşturur. Kimliği cache'ler. */
function getUploadFolder_() {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('UPLOAD_FOLDER_ID');
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); } catch (err) { /* silinmiş olabilir, yeniden kur */ }
  }
  const it = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
  props.setProperty('UPLOAD_FOLDER_ID', folder.getId());
  return folder;
}

// ---------------------------------------------------------------------------
// 3) doGet — geçmiş kayıtlar
// ---------------------------------------------------------------------------

/**
 * Sheet okuması ölçümlerde 6-30 saniye sürüyor. Sonucu önbelleğe alıyoruz;
 * yeni fiş yazıldığında sürüm numarası artıyor ve eski önbellek kendiliğinden
 * geçersiz kalıyor (anahtarın içinde sürüm var).
 */
function dataVersion_() {
  return PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '0';
}

function bumpDataVersion_() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DATA_VERSION', String(Number(dataVersion_()) + 1));
}

/** GET ?action=history&secret=...&limit=50  → en yeni kayıtlar önce. */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (SHARED_SECRET && params.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: 'Yetkisiz istek' });
    }
    if (params.action === 'ping') {
      return json_({ ok: true, message: 'Smart Receipt Apps Script çalışıyor' });
    }

    const cache = CacheService.getScriptCache();
    const cacheKey = 'hist_' + (params.limit || '50') + '_' + dataVersion_();
    const cached = cache.get(cacheKey);
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sheet) return json_({ ok: false, error: SHEET_NAME + ' sayfası yok. Önce setup() çalıştır.' });

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return json_({ ok: true, receipts: [] });

    const limit = Math.min(Number(params.limit) || 50, 200);
    const startRow = Math.max(2, lastRow - limit + 1);
    const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, HEADERS.length).getValues();
    const tz = Session.getScriptTimeZone();

    const receipts = values
      .map((row) => ({
        merchant: row[0],
        date: row[1] instanceof Date ? Utilities.formatDate(row[1], tz, 'yyyy-MM-dd') : String(row[1] || ''),
        time: String(row[2] || ''),
        category: row[3],
        total: row[4],
        currency: row[5],
        tax: row[6],
        bankName: row[7],
        items: String(row[8] || '').split(',').map((s) => s.trim()).filter(Boolean),
        imageUrl: row[9],
        thumbnailUrl: toThumbnailUrl_(row[9]),
        uploadedAt: row[10] instanceof Date ? row[10].toISOString() : String(row[10] || ''),
      }))
      .reverse();

    const payload = JSON.stringify({ ok: true, receipts: receipts });
    // Cache anahtarı başına 100KB sınırı var; büyük listeleri önbelleğe almıyoruz.
    if (payload.length < 90000) cache.put(cacheKey, payload, 300);

    return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Drive dosya URL'sinden <img> ile gösterilebilir küçük resim adresi üretir. */
function toThumbnailUrl_(url) {
  const match = String(url || '').match(/[-\w]{25,}/);
  return match ? 'https://drive.google.com/thumbnail?id=' + match[0] + '&sz=w600' : '';
}

// ---------------------------------------------------------------------------
// 4) Bonus — haftalık e-posta özeti
// ---------------------------------------------------------------------------

/** Bu fonksiyonu haftalık trigger'a bağla (aşağıdaki createWeeklyTrigger). */
function weeklySummaryEmail() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return;

  const tz = Session.getScriptTimeZone();
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues()
    .filter((row) => row[1] instanceof Date && row[1] >= since);

  if (rows.length === 0) {
    Logger.log('Son 7 günde fiş yok, e-posta gönderilmedi.');
    return;
  }

  let total = 0;
  let highest = null;
  const byCategory = {};

  rows.forEach((row) => {
    const amount = Number(row[4]) || 0;
    total += amount;
    byCategory[row[3] || 'Diğer'] = (byCategory[row[3] || 'Diğer'] || 0) + amount;
    if (!highest || amount > Number(highest[4])) highest = row;
  });

  const currency = rows[0][5] || '';
  const categoryLines = Object.keys(byCategory)
    .sort((a, b) => byCategory[b] - byCategory[a])
    .map((cat) => `<li>${cat}: <b>${byCategory[cat].toFixed(2)} ${currency}</b></li>`)
    .join('');

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#111">
      <h2 style="margin:0 0 12px">Haftalık Harcama Özeti</h2>
      <p style="color:#555;margin:0 0 16px">
        ${Utilities.formatDate(since, tz, 'd MMM')} – ${Utilities.formatDate(new Date(), tz, 'd MMM yyyy')}
      </p>
      <p>Toplam harcama: <b style="font-size:18px">${total.toFixed(2)} ${currency}</b></p>
      <p>Eklenen fiş sayısı: <b>${rows.length}</b></p>
      <p>En yüksek harcama: <b>${highest[0]}</b> — ${Number(highest[4]).toFixed(2)} ${highest[5] || ''}</p>
      <p style="margin-bottom:4px">Kategori bazlı:</p>
      <ul style="margin-top:4px">${categoryLines}</ul>
      <p><a href="${ss.getUrl()}">Google Sheet'i aç →</a></p>
    </div>`;

  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: `Smart Receipt — Haftalık Özet (${total.toFixed(2)} ${currency})`,
    htmlBody: html,
  });
}

/** Haftalık trigger'ı kurar. Bir kez elle çalıştırman yeterli. */
function createWeeklyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'weeklySummaryEmail')
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('weeklySummaryEmail')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();

  Logger.log('Haftalık trigger kuruldu: her Pazartesi 09:00');
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

/** "2026-08-06" → gerçek Date nesnesi (Sheet'te tarih olarak saklanmalı ki formüller çalışsın). */
function parseDate_(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Sayıyı güvenli çevirir; boş/null ise hücreyi boş bırakır. */
function toNumber_(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? '' : n;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
