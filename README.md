# ☕ Iced Intentions

The website for **Iced Intentions** — a specialty coffee brand — built as a three-page React experience with online ordering, real-time pickup-slot booking, and event inquiry handling. The goal was to make it feel less like a template coffee-shop page and more like a real product someone could actually order from.

🔗 **Live site:** [iced-intentions.vercel.app](https://iced-intentions.vercel.app)

## ✨ Technologies

- `React 18`
- `Vite`
- `Supabase`
- `EmailJS`
- `Lucide React`
- `CSS` (custom, no framework)

## 🚀 Features

- Browse a full menu of signature drinks with customization options
- Real-time pickup time-slot booking that syncs live across customers
- Works offline-first — falls back to local storage when no backend is configured
- Event inquiry flow for catering, weddings, and pop-ups
- Order confirmation emails on submission
- Fully responsive across desktop, tablet, and mobile

## 📍 The Process

I wanted Iced Intentions to feel like something you could genuinely order from, so I started with the menu and the ordering flow — the heart of the site — and built outward from there.

The trickiest part was the pickup booking. I wanted a customer to reserve a real time slot and have that slot disappear for everyone else the moment it's taken. I wired that up using Supabase's real-time subscriptions so bookings stay in sync across sessions. But I didn't want the whole site to break if the backend wasn't configured, so I built a local-storage fallback — the app works fully offline, then upgrades to live syncing once Supabase is connected.

From there I added the events page for catering and pop-up inquiries, connected EmailJS so submitted orders actually send a confirmation, and spent a good while on the styling — getting it clean and responsive on everything from phones to desktops, all with plain custom CSS and no utility framework.

## 📚 What I Learned

**🔄 Real-time data:** Managing live Supabase subscriptions and keeping slot availability consistent across multiple customers at once.

**📴 Graceful degradation:** Designing the storage layer so the app works with *or* without a backend, then upgrades cleanly when one is available.

**🧾 Third-party integrations:** Wiring up EmailJS to turn a submitted order into a real transactional email.

**📱 Responsive CSS from scratch:** Building polished, responsive layouts without leaning on a framework.

## 💡 How can it be improved?

- Add customer accounts so people can view their past orders
- Build an admin dashboard to manage the menu and view bookings
- Add payment integration for prepaid orders
- Introduce a loyalty / rewards program
- Add automated availability rules (business hours, blackout dates)

## 🚦 Running the Project

1. Clone the repository
2. Install dependencies: `npm install`
3. Run the development server: `npm run dev`
4. Open `http://localhost:3000` in your browser

The site runs fully without any backend setup — it falls back to local storage, so you can explore it right away.

## 🎬 Preview

<!-- Drag a screenshot or a short screen-recording (.mp4) of the site into this section on GitHub and it will embed automatically, just like in the examples you shared. -->
