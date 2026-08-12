/** Tarayıcı tarafı görsel hazırlama. Yalnızca client component'lerden çağrılmalı. */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export type PreparedImage = {
  /** "data:image/jpeg;base64,..." — hem önizleme hem vision API için. */
  dataUrl: string;
  /** data URI başlığı atılmış saf base64 — Apps Script Drive'a bunu yazıyor. */
  base64: string;
  mimeType: string;
  fileName: string;
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} bir görsel olarak açılamadı.`));
    };
    img.src = url;
  });
}

/**
 * Fiş fotoğrafları telefonda 4-8 MB olabiliyor. Uzun kenarı 1600px'e indirip
 * JPEG'e çevirmek hem yükleme süresini hem vision maliyetini düşürüyor;
 * fiş metni bu çözünürlükte rahatça okunuyor.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const img = await loadImage(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tarayıcı canvas desteklemiyor.");

  // Beyaz zemin: şeffaf PNG'ler JPEG'e çevrilince siyah olmasın.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);

  return {
    dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    mimeType: "image/jpeg",
    fileName: file.name,
  };
}
