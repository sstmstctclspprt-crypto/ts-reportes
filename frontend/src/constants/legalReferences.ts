export type LegalPageTab = {
  to: '/privacidad' | '/terminos' | '/seguridad-soporte';
  label: string;
};

export type LegalReferenceLink = {
  id: string;
  label: string;
  href: string;
};

export const legalPageTabs: LegalPageTab[] = [
  { to: '/privacidad', label: 'Política de Privacidad' },
  { to: '/terminos', label: 'Términos y Condiciones' },
  { to: '/seguridad-soporte', label: 'Seguridad y Soporte' }
];

/** Enlaces oficiales de cumplimiento; etiquetas sin nombre de proveedor. */
export const legalReferenceLinks: LegalReferenceLink[] = [
  {
    id: 'soc2',
    label: 'Cumplimiento SOC 2',
    href: 'https://supabase.com/docs/guides/security/soc-2-compliance'
  },
  {
    id: 'rls',
    label: 'Control de acceso a datos',
    href: 'https://supabase.com/docs/guides/database/postgres/row-level-security'
  },
  {
    id: 'backend-security',
    label: 'Seguridad del backend',
    href: 'https://supabase.com/security'
  },
  {
    id: 'hosting-security',
    label: 'Seguridad del hosting',
    href: 'https://vercel.com/security'
  },
  {
    id: 'hosting-compliance',
    label: 'Cumplimiento del hosting',
    href: 'https://vercel.com/docs/security/compliance'
  },
  {
    id: 'trust-center',
    label: 'Centro de confianza',
    href: 'https://www.microsoft.com/en-us/trust-center'
  },
  {
    id: 'cloud-backup',
    label: 'Protección en la nube',
    href: 'https://support.microsoft.com/en-us/onedrive/how-onedrive-safeguards-your-data-in-the-cloud'
  },
  {
    id: 'automation-security',
    label: 'Seguridad de automatización',
    href: 'https://learn.microsoft.com/en-us/power-automate/process-advisor-security'
  }
];
