// Photos from a phone are 3–8 MB and the act needs "four angles you can look
// at", not a print. Downsized here, in the browser, to a JPEG no wider than
// 1600 px before it goes anywhere: the upload is a few hundred kilobytes and
// the server never has to decode HEIC (Safari does that for us on the way
// into the canvas).
import { api } from '../api.js';

export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_QUALITY = 0.82;

export interface PreparedPhoto {
  name: string;
  mimeType: 'image/jpeg';
  blob: Blob;
  previewUrl: string;
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img>, which Safari handles for HEIC */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`cannot read ${file.name}`));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const img = await loadImage(file);
  const w = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const h = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if ('close' in img) img.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
  if (!blob) throw new Error('cannot encode');
  return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mimeType: 'image/jpeg', blob, previewUrl: URL.createObjectURL(blob) };
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Upload one prepared photo or document to an endpoint that takes {mimeType, label, dataBase64}. */
export async function uploadFile(
  url: string,
  file: { name: string; mimeType: string; blob: Blob },
  extra: Record<string, unknown> = {},
  key?: string,
): Promise<string> {
  const { id } = await api.post<{ id: string }>(url, { mimeType: file.mimeType, label: file.name, dataBase64: await toBase64(file.blob), ...extra }, { key });
  return id;
}

/** Sequential, so a phone on a weak link is not asked to push four uploads at once. */
export async function uploadAll(url: string, files: PreparedPhoto[], onDone?: (n: number) => void, key?: string): Promise<string[]> {
  const ids: string[] = [];
  // With a key, each photo gets its own derived from it: a retry after a lost
  // answer finds the ones already stored instead of storing them twice.
  for (const [i, f] of files.entries()) {
    ids.push(await uploadFile(url, f, {}, key ? `${key}-${i}` : undefined));
    onDone?.(ids.length);
  }
  return ids;
}
