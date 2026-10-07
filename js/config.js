// Адреса сервера. Локально (тесты, разработка) используется Supabase из Docker.
const LOCAL = {
  url: 'http://127.0.0.1:54321',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
};

// Боевой проект Supabase. Ключ публичный: защита держится на RLS и функциях базы.
const PROD = {
  url: '',
  key: '',
};

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const SERVER = isLocal ? LOCAL : PROD;
