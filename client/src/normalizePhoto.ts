/** Max long edge for vision upload (Gemma often resizes ~896²). */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.88;

/**
 * Re-encode any browser-decodable image as a reasonably sized JPEG.
 * Avoids HEIC/WebP/huge camera files that break LM Studio's mtmd decoder
 * (which then falls through to ffprobe and fails with Channel Error).
 */
export async function normalizePhotoForScan(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    throw new Error(
      "Couldn’t read that image. Export or save as JPEG/PNG (iPhone HEIC often needs “Most Compatible” or a screenshot)."
    );
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Couldn’t prepare the photo for scanning");
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) {
      throw new Error("Couldn’t convert the photo to JPEG");
    }

    const base =
      file.name.replace(/\.[^.]+$/, "") ||
      `scan-${Date.now()}`;
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
