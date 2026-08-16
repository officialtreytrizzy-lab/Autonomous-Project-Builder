import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

export async function generateDesktopIcon({ source, output }) {
  await mkdir(dirname(output), { recursive: true });
  const info = await sharp(source)
    .resize(512, 512)
    .png()
    .toFile(output);

  return { width: info.width, height: info.height, format: info.format };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const source = resolve(process.cwd(), 'src', 'app', 'icon.svg');
  const output = resolve(process.cwd(), 'build', 'desktop-icon.png');
  const result = await generateDesktopIcon({ source, output });
  process.stdout.write(`${JSON.stringify({ output, ...result })}\n`);
}
