# راه‌اندازی D1 برای miliconfig Pro

این نسخه کاملاً بدون Supabase است. ذخیره‌سازی پنل، احراز هویت، توکن‌ها، استقرارها، کاربران Telegram و لاگ‌ها روی Cloudflare D1 انجام می‌شود.

## 1) ساخت D1

در Cloudflare بروید به:

Workers & Pages → D1 → Create database

نام پیشنهادی:

`miliconfig-db`

## 2) اجرای migration

از ریشه پروژه:

```bash
npx wrangler d1 migrations apply miliconfig-db --remote
```

یا SQL داخل `migrations/0001_initial.sql` را در D1 Console اجرا کنید.

## 3) اتصال D1 به Worker

در Worker:

Settings → Bindings → Add binding → D1 database

مقادیر:

- Variable name: `DB`
- D1 database: `miliconfig-db`

این نام `DB` باید دقیقاً همین باشد.

## 4) Build/Deploy

این تنظیمات را نگه دارید:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

`wrangler.toml` هم Static Assets را از `./dist` سرو می‌کند.

## 5) ربات Telegram

Webhook ربات:

`https://YOUR-WORKER-DOMAIN/telegram`

از داخل پنل می‌توانید آن را به‌صورت خودکار ثبت کنید.

## نکته امنیتی

توکن Cloudflare و Bot Token فقط در D1 سمت Worker ذخیره می‌شوند و دیگر داخل bundle مرورگر یا متغیرهای `VITE_*` قرار نمی‌گیرند.
