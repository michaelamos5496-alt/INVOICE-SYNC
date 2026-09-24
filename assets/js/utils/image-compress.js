/**
 * image-compress.js — shrinks a photo picked from a phone camera or the
 * file system into something small enough to store in the browser.
 *
 * A modern phone photo is 3–8 MB and 4000+ px wide; a product thumbnail
 * needs ~1000 px. Resizing (and re-encoding as WebP, or JPEG where the
 * browser can't write WebP) typically cuts that to 60–150 KB with no
 * visible loss on a product card, which is what makes browser-side
 * storage workable at all. Everything happens on-device; nothing is
 * uploaded anywhere.
 */
export const IMAGE_LIMITS = Object.freeze({
  maxInputBytes: 25 * 1024 * 1024,
  maxDimension: 1200,
  quality: 0.82,
});

const UNSUPPORTED = 'That file isn\'t a supported photo. Use a JPG, PNG or WebP image.';

/** Decodes with EXIF rotation applied, so a portrait phone photo isn't stored sideways. */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through to the <img> path below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('Couldn\'t read that image. Try a JPG or PNG instead.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * @param {File} file
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 * @throws {Error} with a message that's safe to show the user
 */
export async function compressImage(file, { maxDimension = IMAGE_LIMITS.maxDimension, quality = IMAGE_LIMITS.quality } = {}) {
  // SVG is excluded on purpose: it can carry script and isn't a photo.
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error(UNSUPPORTED);
  if (file.size > IMAGE_LIMITS.maxInputBytes) throw new Error('That photo is over 25 MB. Choose a smaller one.');

  const source = await decode(file);
  const srcWidth = source.naturalWidth ?? source.width;
  const srcHeight = source.naturalHeight ?? source.height;
  if (!srcWidth || !srcHeight) throw new Error(UNSUPPORTED);

  const scale = Math.min(1, maxDimension / Math.max(srcWidth, srcHeight)); // never upscale
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);

  let blob = await toBlob(canvas, 'image/webp', quality);
  if (!blob || blob.type !== 'image/webp') {
    // This browser can't encode WebP. JPEG has no transparency, so flatten onto white
    // (otherwise a transparent PNG would turn black).
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    blob = await toBlob(canvas, 'image/jpeg', quality);
  }
  source.close?.();
  if (!blob) throw new Error('Couldn\'t process that image. Try a different one.');

  // Already small and efficiently compressed? Re-encoding could make it bigger — keep the original.
  if (scale === 1 && blob.size >= file.size && /^image\/(jpeg|webp)$/.test(file.type)) {
    return { blob: file, width, height };
  }
  return { blob, width, height };
}
