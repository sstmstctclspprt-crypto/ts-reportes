/** Persistente hasta que el usuario permita la cámara o pulse cerrar en Home (para no depender solo del toast). */
export const REGISTRO_CAMERA_BLOCKED_KEY = 'ts_registro_camera_blocked_v1';

export type CameraPreflightOutcome =
  | { ok: true }
  | { ok: false; reason: 'denied'; persistent: boolean }
  | { ok: false; reason: 'unsupported' };

function setBlockedHint() {
  try {
    sessionStorage.setItem(REGISTRO_CAMERA_BLOCKED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearRegistroCameraBlockedHint() {
  try {
    sessionStorage.removeItem(REGISTRO_CAMERA_BLOCKED_KEY);
  } catch {
    /* ignore */
  }
}

export function hasRegistroCameraBlockedHint(): boolean {
  try {
    return sessionStorage.getItem(REGISTRO_CAMERA_BLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

async function queryCameraPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const perm = navigator.permissions as unknown as {
      query?: (desc: PermissionDescriptor) => Promise<PermissionStatus>;
    };
    if (!perm?.query) return 'unknown';
    // Chrome/Edge: 'camera'; puede no existir en todos los TS DOM
    const status = await perm.query({ name: 'camera' as PermissionName });
    const s = status.state;
    if (s === 'granted' || s === 'denied' || s === 'prompt') return s;
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Solicita permiso de cámara antes del registro.
 * Si el usuario ya denegó antes, el navegador suele no volver a mostrar el diálogo: usamos Permissions API cuando existe.
 */
export async function preflightCameraForRegistro(): Promise<CameraPreflightOutcome> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { ok: false, reason: 'unsupported' };
  }

  const m = navigator.mediaDevices;
  if (!m?.getUserMedia) {
    return { ok: false, reason: 'unsupported' };
  }

  const permState = await queryCameraPermissionState();
  if (permState === 'denied') {
    setBlockedHint();
    return { ok: false, reason: 'denied', persistent: true };
  }

  try {
    let stream: MediaStream;
    try {
      stream = await m.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });
    } catch {
      stream = await m.getUserMedia({ video: true });
    }
    stream.getTracks().forEach((t) => t.stop());
    clearRegistroCameraBlockedHint();
    return { ok: true };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    setBlockedHint();
    const persistent = name === 'NotAllowedError' || name === 'SecurityError';
    return { ok: false, reason: 'denied', persistent };
  }
}

export function toastMessageForCameraDenial(persistent: boolean): { title: string; message: string } {
  if (persistent) {
    return {
      title: 'Cámara bloqueada para este sitio',
      message:
        'El navegador no volverá a preguntar hasta que cambies el permiso: toca el candado o ⋮ en la barra de dirección → Permisos / Configuración del sitio → Cámara → Permitir. Actualiza la página si hace falta y vuelve a pulsar «Nuevo registro».'
    };
  }
  return {
    title: 'Cámara requerida',
    message:
      'Debes permitir el acceso a la cámara para abrir el registro. Si lo rechazaste, usa el mismo menú del sitio para permitirla y vuelve a intentar.'
  };
}
