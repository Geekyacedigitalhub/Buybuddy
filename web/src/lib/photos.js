/**
 * Photos from a phone camera, made small enough to be useful.
 *
 * A merchant's phone photo is 3–8 MB. Uploaded raw, a hundred products fill the
 * disk and every customer waits for megapixels they cannot see. This resizes to
 * 1200 px on the long edge and re-encodes as JPEG before it ever leaves the
 * device — typically 150–250 kB, indistinguishable on a phone screen.
 */
import { api } from './api.js';

const MAX_EDGE = 1200;
const QUALITY = 0.82;

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file is not an image we can use.'));
    img.src = src;
  });

/** Resize + compress in the browser. Returns a JPEG data URL. */
export async function compressImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  if (!file) throw new Error('Choose a photo first.');
  if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(file.type || '')) {
    throw new Error('Please choose a JPG, PNG or HEIC photo.');
  }
  const raw = await readAsDataUrl(file);
  const img = await loadImage(raw);

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // White behind the photo: PNG logos with transparency would otherwise turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Compress, then store on the server. Returns the URL to save on the product,
 * store or order. The server re-checks what it receives, so a bad file fails
 * here with a clear message instead of at checkout.
 */
export async function uploadPhoto(file, { maxEdge, quality } = {}) {
  const dataUrl = await compressImage(file, { maxEdge, quality });
  const res = await api.post('/api/uploads', { data_url: dataUrl });
  return res.url;
}
