/**
 * Microsoft Graph (app-only) → SharePoint biblioteca predeterminada del sitio.
 * Requiere permisos de aplicación (p. ej. Sites.Selected + concesión en el sitio, o Sites.ReadWrite.All en dev).
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

const GRAPH_MAX_ATTEMPTS = 4;
const GRAPH_RETRY_BASE_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function graphStatusRetryable(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 504);
}

async function graphErrorDetail(res: Response): Promise<string> {
  const t = await res.text();
  try {
    const j = JSON.parse(t) as {
      error?: { message?: string; code?: string };
    };
    return j.error?.message ?? t;
  } catch {
    return t;
  }
}

export async function graphFetch(
  accessToken: string,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers as HeadersInit);
  headers.set('Authorization', `Bearer ${accessToken}`);

  let lastNonRetryable = '';

  for (let attempt = 0; attempt < GRAPH_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers
      });

      if (res.ok) return res;

      const detail = await graphErrorDetail(res);

      if (res.status === 401) {
        throw new Error(
          `Microsoft Graph (401): token de aplicación inválido o tenant incorrecto. Revisa AZURE_* en Supabase. ${detail.slice(0, 200)}`
        );
      }
      if (res.status === 403) {
        throw new Error(
          `Microsoft Graph (403): permisos insuficientes o falta grant de Sites.Selected en el sitio SharePoint. ${detail.slice(0, 400)}`
        );
      }

      if (!graphStatusRetryable(res.status) || attempt === GRAPH_MAX_ATTEMPTS - 1) {
        lastNonRetryable = `Microsoft Graph (${res.status}): ${detail.slice(0, 600)}`;
        throw new Error(lastNonRetryable);
      }

      await sleep(GRAPH_RETRY_BASE_MS * Math.pow(2, attempt));
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Microsoft Graph (')) throw e;

      const isLast = attempt === GRAPH_MAX_ATTEMPTS - 1;
      if (isLast) {
        throw new Error(
          `No se pudo conectar con Microsoft Graph tras varios intentos: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      await sleep(GRAPH_RETRY_BASE_MS * Math.pow(2, attempt));
    }
  }

  throw new Error(lastNonRetryable || 'Error desconocido en Microsoft Graph');
}

export async function getGraphAppAccessToken(): Promise<string> {
  const tenant = Deno.env.get('AZURE_TENANT_ID')?.trim();
  const clientId = Deno.env.get('AZURE_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET')?.trim();
  if (!tenant || !clientId || !clientSecret) {
    throw new Error(
      'Configura AZURE_TENANT_ID, AZURE_CLIENT_ID y AZURE_CLIENT_SECRET para subir a SharePoint vía Microsoft Graph.'
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Microsoft Graph token (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Microsoft Graph: respuesta OAuth sin access_token.');
  }
  return json.access_token;
}

function resolveSiteResourcePath(): string {
  const full = Deno.env.get('GRAPH_SHAREPOINT_SITE_ID')?.trim();
  if (full) return full;
  const host = Deno.env.get('GRAPH_SITE_HOSTNAME')?.trim();
  const path = Deno.env.get('GRAPH_SITE_PATH')?.trim();
  if (host && path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${host}:${p}`;
  }
  throw new Error(
    'Configura GRAPH_SHAREPOINT_SITE_ID (id del sitio) o GRAPH_SITE_HOSTNAME + GRAPH_SITE_PATH (p. ej. contoso.sharepoint.com y /sites/CTPAT).'
  );
}

export async function getDefaultDocumentLibraryDriveId(accessToken: string): Promise<string> {
  const sitePath = resolveSiteResourcePath();
  const siteUrl = `${GRAPH_BASE}/sites/${encodeURIComponent(sitePath)}`;
  const siteRes = await graphFetch(accessToken, siteUrl);
  const site = (await siteRes.json()) as { id?: string };
  if (!site.id) {
    throw new Error('Microsoft Graph: sitio SharePoint no encontrado. Revisa GRAPH_* / permisos.');
  }
  const driveUrl = `${GRAPH_BASE}/sites/${site.id}/drive`;
  const driveRes = await graphFetch(accessToken, driveUrl);
  const drive = (await driveRes.json()) as { id?: string };
  if (!drive.id) {
    throw new Error('Microsoft Graph: no se pudo obtener la biblioteca predeterminada del sitio.');
  }
  return drive.id;
}

function rootFolderName(): string {
  return Deno.env.get('GRAPH_ROOT_FOLDER_NAME')?.trim() || 'TS REPORTES';
}

/**
 * Una carpeta por registro: .../users/{userId}/TS-REPORTES S{n}/
 * (n secuencial por usuario: S1, S2, S3…)
 */
export function userPdfFolderSegments(userId: string, reportSeq: number): string[] {
  const n = Number.isFinite(reportSeq) && reportSeq > 0 ? Math.floor(reportSeq) : 1;
  const label = `TS-REPORTES S${n}`;
  return [rootFolderName(), 'users', userId, label];
}

export async function ensureFolderPath(
  accessToken: string,
  driveId: string,
  segments: string[]
): Promise<string> {
  let parentId = 'root';
  for (const name of segments) {
    parentId = await ensureChildFolder(accessToken, driveId, parentId, name);
  }
  return parentId;
}

async function ensureChildFolder(
  accessToken: string,
  driveId: string,
  parentId: string,
  name: string
): Promise<string> {
  const childrenUrl =
    parentId === 'root'
      ? `${GRAPH_BASE}/drives/${driveId}/root/children`
      : `${GRAPH_BASE}/drives/${driveId}/items/${parentId}/children`;

  const listRes = await graphFetch(accessToken, childrenUrl);
  const data = (await listRes.json()) as {
    value?: { id: string; name: string; folder?: Record<string, unknown> }[];
  };
  const found = data.value?.find((v) => v.name === name && v.folder != null);
  if (found) return found.id;

  const createUrl =
    parentId === 'root'
      ? `${GRAPH_BASE}/drives/${driveId}/root/children`
      : `${GRAPH_BASE}/drives/${driveId}/items/${parentId}/children`;

  const createRes = await graphFetch(accessToken, createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail'
    })
  });

  if (createRes.ok) {
    const created = (await createRes.json()) as { id?: string };
    if (!created.id) throw new Error(`Microsoft Graph: carpeta "${name}" sin id.`);
    return created.id;
  }

  if (createRes.status === 409) {
    const retry = await graphFetch(accessToken, childrenUrl);
    const retryData = (await retry.json()) as {
      value?: { id: string; name: string; folder?: Record<string, unknown> }[];
    };
    const again = retryData.value?.find((v) => v.name === name && v.folder != null);
    if (again) return again.id;
  }

  const errText = await createRes.text();
  throw new Error(`Microsoft Graph: no se pudo crear carpeta "${name}": ${errText.slice(0, 400)}`);
}

export async function uploadFileToFolder(
  accessToken: string,
  driveId: string,
  folderItemId: string,
  fileName: string,
  content: Uint8Array,
  contentType: string
): Promise<{ id: string }> {
  const url = `${GRAPH_BASE}/drives/${driveId}/items/${folderItemId}:/${encodeURIComponent(fileName)}:/content`;
  const res = await graphFetch(accessToken, url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: content
  });
  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new Error('Microsoft Graph: subida sin id de elemento.');
  }
  return { id: json.id };
}
