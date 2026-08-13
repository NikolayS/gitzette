export type ImageDimensions = { width: number; height: number };

export function hasPublicationDimensions(dimensions: ImageDimensions): boolean {
  return dimensions.width >= 256 && dimensions.height >= 256
    && dimensions.width <= 2048 && dimensions.height <= 2048;
}

export function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 30) return null;
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (text(0, 4) !== "RIFF" || text(8, 12) !== "WEBP" || view.getUint32(4, true) + 8 !== bytes.byteLength) return null;

  const chunk = text(12, 16);
  if (chunk === "VP8X" && bytes.byteLength >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { width, height };
  }
  if (chunk === "VP8L" && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    const limit = Math.min(bytes.byteLength - 7, 64);
    for (let index = 20; index <= limit; index++) {
      if (bytes[index] === 0x9d && bytes[index + 1] === 0x01 && bytes[index + 2] === 0x2a) {
        return {
          width: view.getUint16(index + 3, true) & 0x3fff,
          height: view.getUint16(index + 5, true) & 0x3fff,
        };
      }
    }
  }
  return null;
}
