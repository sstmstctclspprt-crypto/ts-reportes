import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import {
  preflightCameraForRegistro,
  toastMessageForCameraDenial
} from '../utils/cameraPermission';
import HomeView from '../views/HomeView.vue';
import RegistroView from '../views/RegistroView.vue';
import PrivacyView from '../views/PrivacyView.vue';
import TermsView from '../views/TermsView.vue';
import SecuritySupportView from '../views/SecuritySupportView.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomeView
  },
  {
    path: '/registro/new',
    name: 'registro-new',
    component: RegistroView
  },
  {
    path: '/registro/:id',
    name: 'registro-edit',
    component: RegistroView,
    props: true
  },
  {
    path: '/privacidad',
    name: 'privacy',
    component: PrivacyView
  },
  {
    path: '/terminos',
    name: 'terms',
    component: TermsView
  },
  {
    path: '/seguridad-soporte',
    name: 'security-support',
    component: SecuritySupportView
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

/** Rutas que usan API/Supabase: renovar JWT antes de entrar (reduce 401 tras inactividad). */
const ROUTES_NEED_SESSION_REFRESH = new Set(['home', 'registro-new', 'registro-edit']);

router.beforeEach(async (to, _from, next) => {
  const auth = useAuthStore();
  const name = to.name;
  if (typeof name === 'string' && ROUTES_NEED_SESSION_REFRESH.has(name)) {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        if (auth.isSignedIn) {
          await auth.refreshSessionForApi({ force: false });
        }
      } catch {
        /* seguir navegando; el guard de pantalla mostrará error si hace falta */
      }
    }
  }

  if (name === 'registro-new' || name === 'registro-edit') {
    const outcome = await preflightCameraForRegistro();
    if (!outcome.ok && outcome.reason === 'denied') {
      const toast = useToastStore();
      const { title, message } = toastMessageForCameraDenial(outcome.persistent);
      // Navegar primero: si el toast va con la navegación, a veces no se pinta.
      next({ name: 'home', replace: true });
      window.setTimeout(() => {
        toast.error(title, message);
      }, 150);
      return;
    }
    if (!outcome.ok && outcome.reason === 'unsupported') {
      const toast = useToastStore();
      window.setTimeout(() => {
        toast.info(
          'Cámara no disponible',
          'Este entorno no permite usar la cámara (por ejemplo sitio sin HTTPS). Si el navegador lo permite, podrás elegir fotos desde la galería en el formulario.'
        );
      }, 150);
    }
  }

  next();
});

export default router;

