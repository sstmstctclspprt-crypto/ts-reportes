import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { useAccessStore } from '../stores/accessStore';
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
import ActivacionView from '../views/ActivacionView.vue';
import AdminView from '../views/AdminView.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomeView
  },
  {
    path: '/activacion',
    name: 'activacion',
    component: ActivacionView
  },
  {
    path: '/admin',
    name: 'admin',
    component: AdminView
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

const PUBLIC_ROUTE_NAMES = new Set(['privacy', 'terms', 'security-support']);
const APP_ROUTE_NAMES = new Set(['home', 'registro-new', 'registro-edit', 'admin', 'activacion']);

/** Rutas que usan API/Supabase: renovar JWT antes de entrar (reduce 401 tras inactividad). */
const ROUTES_NEED_SESSION_REFRESH = new Set(['home', 'registro-new', 'registro-edit', 'admin', 'activacion']);

router.beforeEach(async (to, _from, next) => {
  const auth = useAuthStore();
  const access = useAccessStore();
  const name = to.name;

  if (typeof name === 'string' && PUBLIC_ROUTE_NAMES.has(name)) {
    next();
    return;
  }

  if (typeof name === 'string' && ROUTES_NEED_SESSION_REFRESH.has(name)) {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        if (auth.isSignedIn) {
          await auth.refreshSessionForApi({ force: false });
        }
      } catch {
        /* seguir navegando */
      }
    }
  }

  if (typeof name === 'string' && APP_ROUTE_NAMES.has(name)) {
    if (!auth.isSignedIn) {
      if (name === 'home') {
        next();
        return;
      }
      next({ name: 'home', replace: true });
      return;
    }

    if (!access.ready) {
      await access.syncContext();
    }

    if (name === 'admin') {
      if (!access.isAdmin) {
        next({ name: 'home', replace: true });
        return;
      }
    } else if (name === 'activacion') {
      if (access.isApproved) {
        next({ name: 'home', replace: true });
        return;
      }
    } else if (!access.isApproved) {
      next({ name: 'activacion', replace: true });
      return;
    }
  }

  if (name === 'registro-new' || name === 'registro-edit') {
    const outcome = await preflightCameraForRegistro();
    if (!outcome.ok && outcome.reason === 'denied') {
      const toast = useToastStore();
      const { title, message } = toastMessageForCameraDenial(outcome.persistent);
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
