import { createCanvas, loadImage } from '@napi-rs/canvas';

const TARGET_LONGEST_SIDE = 768;

export type ResizedImage = {
  buffer: Buffer;
  mimeType: string;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
};

export async function resizeImageForApi(buffer: Buffer): Promise<ResizedImage> {
  const image = await loadImage(buffer);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const longestSide = Math.max(sourceWidth, sourceHeight);

  if (longestSide <= 0) {
    throw new Error('Could not determine image dimensions');
  }

  const scale = TARGET_LONGEST_SIDE / longestSide;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  return {
    buffer: canvas.toBuffer('image/png'),
    mimeType: 'image/png',
    sourceWidth,
    sourceHeight,
    width,
    height,
  };
}
