// Установка как приложение и работа оболочки без сети
import { toast } from './ui.js';

let prompt = null;

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  prompt = e;
});

addEventListener('appinstalled', () => {
  prompt = null;
  toast('Доска установлена как приложение');
});

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// Пункт меню показываем, если браузер умеет ставить или это айфон (там вручную)
export const canInstall = () => !standalone() && (!!prompt || ios());

export async function installApp() {
  if (prompt) {
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    prompt = null;
  } else if (ios()) {
    toast('В Safari нажмите «Поделиться», затем «На экран Домой»');
  }
}
