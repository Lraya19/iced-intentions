# Iced Intentions

The website for Iced Intentions coffee — a 3-page React site with online ordering, real-time time-slot booking, and event inquiry handling.

## Quick start

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`.

The site works fully **without any backend setup** — it falls back to localStorage. To enable production features (cross-customer slot syncing, order emails), follow `DEPLOYMENT.md`.

## What's where

```
iced-intentions/
├── src/
│   ├── App.jsx         ← Main app: pages, components, menu data
│   ├── supabase.js     ← Supabase client initialization
│   ├── storage.js      ← Slot/order/event storage (Supabase or localStorage)
│   ├── email.js        ← Order email via EmailJS
│   ├── main.jsx        ← React entry point
│   └── index.css       ← Global styles + responsive layouts
├── public/
│   └── favicon.svg     ← Browser tab icon
├── .env.example        ← Copy to `.env` and fill in
├── DEPLOYMENT.md       ← Full step-by-step guide to going live
└── package.json
```

## What does what

- **Landing page** — Brand story, signature drinks, full menu, hours
- **Order page** — Browse menu, customize drinks, pick pickup time, submit
- **Events page** — Inquire about catering, weddings, pop-ups

## Updating the menu

All menu items are in `src/App.jsx` near the top, in the `MENU` constant. Each drink has:

```js
{ id: 'matcha-verdi', name: 'Matcha Verdí', desc: '...', priceL: 9.50, priceBucket: 17.00, gradient: '...' }
```

Edit prices, names, or descriptions there, save, and refresh.

## Updating contact info

Edit your `.env` (or Vercel environment variables in production):

```
VITE_BUSINESS_PHONE=...
VITE_BUSINESS_ADDRESS=...
VITE_BUSINESS_INSTAGRAM=...
```

## Available scripts

```bash
npm run dev       # Local dev server at localhost:3000
npm run build     # Production build (output in dist/)
npm run preview   # Preview the production build locally
```

## Tech stack

- **React 18** + **Vite** — fast, modern, lightweight
- **Supabase** — Postgres database + real-time subscriptions
- **EmailJS** — order email notifications
- **Lucide React** — icons
- Custom CSS — no Tailwind dependency, just clean responsive styles

## Going live

See `DEPLOYMENT.md` for the full guide.

## License

Private. © Iced Intentions.
