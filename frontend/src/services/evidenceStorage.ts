import { supabase } from '../supabaseClient';

const EVIDENCE_BUCKET = ((import.meta.env.VITE_EVIDENCE_BUCKET as string | undefined)?.trim() || 'ctpat-evidence');

export interface EvidenceUploadInput {
  userId: string;
  organizationId: string;
  payloadId: string;
  imageDataUrls: string[];
  signatureOperadorDataUrl?: string;
  signatureOficialDataUrl?: string;
}

export interface EvidenceUploadOutput {
  imagePaths: string[];
  signatureOperadorPath: string | null;
  signatureOficialPath: string | null;
}

function sanitizeSegment(input: string): string {
  const compact = input.trim().toLowerCase();
  const safe = compact.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'unknown';
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array; extension: string } | null {
  const m = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1].trim().toLowerCase();
  const b64 = m[2];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const extension = mime.includes('png') ? 'png' : 'jpg';
  return { mime, bytes, extension };
}

async function uploadDataUrl(
  dataUrl: string,
  objectPath: string
): Promise<string> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error('Formato de imagen inválido.');
  }
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(objectPath, parsed.bytes, {
    upsert: true,
    contentType: parsed.mime
  });
  if (error) {
    throw new Error(`No se pudo subir evidencia sensible: ${error.message}`);
  }
  return objectPath;
}

export async function uploadSensitiveEvidence(
  input: EvidenceUploadInput
): Promise<EvidenceUploadOutput> {
  const org = sanitizeSegment(input.organizationId);
  const uid = sanitizeSegment(input.userId);
  const pid = sanitizeSegment(input.payloadId);
  const rootPath = `organizations/${org}/${uid}/registros/${pid}`;

  const imagePaths: string[] = [];
  for (let i = 0; i < input.imageDataUrls.length; i++) {
    const dataUrl = input.imageDataUrls[i];
    if (!dataUrl || !dataUrl.startsWith('data:')) continue;
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) continue;
    const objectPath = `${rootPath}/images/evidence_${i + 1}.${parsed.extension}`;
    const stored = await uploadDataUrl(dataUrl, objectPath);
    imagePaths.push(stored);
  }

  let signatureOperadorPath: string | null = null;
  if (input.signatureOperadorDataUrl?.startsWith('data:')) {
    const parsed = parseDataUrl(input.signatureOperadorDataUrl);
    if (parsed) {
      signatureOperadorPath = await uploadDataUrl(
        input.signatureOperadorDataUrl,
        `${rootPath}/signatures/operador.${parsed.extension}`
      );
    }
  }

  let signatureOficialPath: string | null = null;
  if (input.signatureOficialDataUrl?.startsWith('data:')) {
    const parsed = parseDataUrl(input.signatureOficialDataUrl);
    if (parsed) {
      signatureOficialPath = await uploadDataUrl(
        input.signatureOficialDataUrl,
        `${rootPath}/signatures/oficial.${parsed.extension}`
      );
    }
  }

  return { imagePaths, signatureOperadorPath, signatureOficialPath };
}
