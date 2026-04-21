-- Políticas RLS de Storage para logos de servicio (bucket por defecto: ctpat-logs).
-- La PWA sube a: logos/<auth.uid()>.png|jpg (ver authStore.uploadServiceLogo).
-- Sin estas políticas, INSERT falla con: "new row violates row-level security policy".

-- Ajusta el nombre del bucket si usas otro (debe coincidir con VITE_LOGO_BUCKET / LOGO_BUCKET).

DROP POLICY IF EXISTS "ctpat_logs_insert_own_logo" ON storage.objects;
DROP POLICY IF EXISTS "ctpat_logs_update_own_logo" ON storage.objects;
DROP POLICY IF EXISTS "ctpat_logs_delete_own_logo" ON storage.objects;
DROP POLICY IF EXISTS "ctpat_logs_select_public" ON storage.objects;

-- Lectura pública (getPublicUrl en la PWA y PDFs que usan URL pública del bucket)
CREATE POLICY "ctpat_logs_select_public"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'ctpat-logs');

CREATE POLICY "ctpat_logs_insert_own_logo"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ctpat-logs'
    AND (
      name = 'logos/' || auth.uid()::text || '.png'
      OR name = 'logos/' || auth.uid()::text || '.jpg'
    )
  );

CREATE POLICY "ctpat_logs_update_own_logo"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'ctpat-logs'
    AND (
      name = 'logos/' || auth.uid()::text || '.png'
      OR name = 'logos/' || auth.uid()::text || '.jpg'
    )
  )
  WITH CHECK (
    bucket_id = 'ctpat-logs'
    AND (
      name = 'logos/' || auth.uid()::text || '.png'
      OR name = 'logos/' || auth.uid()::text || '.jpg'
    )
  );

CREATE POLICY "ctpat_logs_delete_own_logo"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'ctpat-logs'
    AND (
      name = 'logos/' || auth.uid()::text || '.png'
      OR name = 'logos/' || auth.uid()::text || '.jpg'
    )
  );
