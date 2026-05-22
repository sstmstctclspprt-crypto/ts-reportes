import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'frontend/public/logo.png');
const pngOut = path.join(root, 'backend/supabase/functions/generate-ctpat-pdf/assets/logo-watermark.png');
const tsOut = path.join(root, 'backend/supabase/functions/generate-ctpat-pdf/watermarkLogoEmbedded.ts');

await sharp(src).png().toFile(pngOut);
const b64 = fs.readFileSync(pngOut).toString('base64');
const ts =
  '/** Marca de agua Tactical Support (PNG, desde frontend/public/logo.png) */\n' +
  `export const WATERMARK_LOGO_PNG_BASE64 = ${JSON.stringify(b64)};\n`;
fs.writeFileSync(tsOut, ts);
console.log('OK', pngOut, 'bytes', fs.statSync(pngOut).size);
