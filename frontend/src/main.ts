import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { warnIfSupabaseFunctionsEnvMismatch } from './supabaseEnvCheck';
import '../tailwind.css';

warnIfSupabaseFunctionsEnvMismatch();

const app = createApp(App);

app.use(createPinia());
app.use(router);

app.mount('#app');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

