<template>
  <LegalPageLayout title="Seguridad y Soporte">
    <h3 class="font-semibold text-slate-900">Compromiso de seguridad</h3>
    <p>
      Tactical Support protege la confidencialidad, integridad y disponibilidad de la información
      de inspecciones C-TPAT mediante controles en la aplicación y en la infraestructura que
      la sustenta. Las prácticas de nuestros proveedores de hosting, backend y respaldo en la nube
      están documentadas en las pestañas de referencia de esta sección.
    </p>

    <h3 class="font-semibold text-slate-900">Arquitectura de seguridad de la aplicación</h3>
    <ul class="list-disc ml-5 space-y-1">
      <li>
        <strong>Entrega web:</strong> la interfaz se publica por HTTPS con políticas de seguridad
        del navegador (HSTS, protección de tipos de contenido, restricción de cámara al origen de la app).
        La interfaz no procesa ni persiste registros C-TPAT en el servidor de hosting.
      </li>
      <li>
        <strong>Autenticación:</strong> inicio de sesión con Google OAuth; sesiones con token JWT
        renovable. Solo usuarios aprobados acceden a datos operativos.
      </li>
      <li>
        <strong>Autorización:</strong> control de acceso por usuario en base de datos (cada operador
        solo ve y modifica sus propios registros). Códigos de invitación y panel de administración
        para gestionar altas.
      </li>
      <li>
        <strong>Almacenamiento:</strong> evidencias y PDFs en buckets privados; logos en bucket
        acotado. Acceso condicionado a usuario autenticado y aprobado.
      </li>
      <li>
        <strong>Generación de PDF:</strong> procesamiento en funciones serverless con validación
        de identidad; subida del reporte a Google Drive y notificación de respaldo corporativo
        mediante URL firmada de corta duración.
      </li>
      <li>
        <strong>Retención:</strong> datos sensibles en backend con expiración automática (~7 días);
        purga programada de registros vencidos en base de datos.
      </li>
      <li>
        <strong>Operación offline:</strong> cola local en el dispositivo cuando no hay conexión;
        sincronización al restablecer la red.
      </li>
    </ul>

    <h3 class="font-semibold text-slate-900">Confidencialidad y cumplimiento</h3>
    <p>
      La infraestructura del backend y del hosting cuenta con certificaciones y marcos de cumplimiento
      (incluido SOC 2 en el proveedor de backend). El respaldo corporativo en la nube aplica cifrado
      en tránsito y en reposo, control de acceso con privilegio mínimo y monitoreo de seguridad,
      conforme a la documentación oficial enlazada en las pestañas superiores.
    </p>

    <h3 class="font-semibold text-slate-900">Responsabilidades del usuario</h3>
    <ul class="list-disc ml-5 space-y-1">
      <li>Proteger la cuenta Google y habilitar verificación en dos pasos cuando sea posible.</li>
      <li>No compartir códigos de acceso ni sesiones activas.</li>
      <li>Usar dispositivos actualizados y con bloqueo de pantalla en el patio.</li>
      <li>Reportar de inmediato accesos sospechosos o pérdida de dispositivo.</li>
    </ul>

    <h3 class="font-semibold text-slate-900">Atención y soporte</h3>
    <p>
      Responsable: <strong>Javier Ramirez</strong><br />
      Teléfono: <a href="tel:+528146160553" class="text-tactical-blue hover:underline">+52 81 4616 0553</a><br />
      Sitio: <a href="https://tacticalsupport.online" class="text-tactical-blue hover:underline" target="_blank" rel="noopener noreferrer">tacticalsupport.online</a>
    </p>

    <h3 class="font-semibold text-slate-900">Reporte de incidentes</h3>
    <p>
      Si detectas un incidente de seguridad, acceso no autorizado, fuga de información o
      comportamiento anómalo en la aplicación, repórtalo de inmediato al contacto de soporte
      indicando fecha, hora, descripción y usuario afectado para su revisión y seguimiento.
    </p>
  </LegalPageLayout>
</template>

<script setup lang="ts">
import LegalPageLayout from '../components/LegalPageLayout.vue';
</script>
