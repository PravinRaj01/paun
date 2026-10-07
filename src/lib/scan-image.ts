import { fitWithin, MAX_SIDE } from "./scan";

/**
 * Shrink a photo in the browser before it is uploaded: longest side 1280 px, JPEG at 0.8 (about 200 to 400 KB). A phone photo is
 * several MB, which would be slow on mobile data and is far more than a receipt needs to be read. Returns the base64 text only
 * (no "data:" prefix). Throws if the file is not an image the browser can open.
 */
export async function resizeToJpegBase64(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file); // applies the photo's rotation (EXIF) in current browsers
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#fff"; // PNG screenshots can be transparent; JPEG has no transparency
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob) throw new Error("encode failed");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  } finally {
    bitmap.close();
  }
}
