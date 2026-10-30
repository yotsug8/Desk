# Доска

Веб-приложение для совместной работы с заметками.

## Устройство

- Клиент: HTML, CSS и JS без сборки (`index.html`, `css/`, `js/`), библиотека Supabase грузится с jsDelivr.
- Сервер: Supabase. Схема, права и функции в `supabase/migrations/`. Клиент только читает таблицы, все изменения идут через функции базы, история пишется триггером.
- Вход без почты: анонимный вход Supabase и имя.

## Запуск у себя

```
npm install
npx supabase start      # локальная база в Docker
npm run serve           # http://localhost:8080
npm test                # тесты Playwright
```
