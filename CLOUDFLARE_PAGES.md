# Cloudflare Workers Build

این repository برای **Cloudflare Workers + Static Assets** تنظیم شده است، نه Pages Git Deploy.

## Cloudflare Build Settings

```text
Build command: npm run build
Deploy command: npx wrangler deploy
Root directory: /
Production branch: main
```

## D1 Binding

در Cloudflare:

Workers & Pages → optimiworker → Settings → Bindings

یک D1 database با نام `DB` اضافه کنید.

Migration:

```text
migrations/0001_initial.sql
```

پس از آن Push به `main` باعث Build و Deploy خودکار می‌شود.

## معماری

```text
GitHub
  ↓
Cloudflare Workers Build
  ↓
Vite → dist/
  ↓
Worker
 ├─ Static Assets
 ├─ /api/*
 ├─ /telegram
 └─ D1 (DB)
```
