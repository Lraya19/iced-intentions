import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, lazy, Suspense } from 'react';
import {
  Heart, ShoppingBag, Calendar, Clock, MapPin, Phone, Instagram,
  ChevronRight, ChevronLeft, X, Plus, Minus, Check, Sparkles,
  Coffee, Star, Loader2, Menu as MenuIcon, CreditCard, Lock,
  User, LogOut, Gift, Mail, Trash2, RotateCcw,
  LayoutDashboard, Power, PauseCircle, PlayCircle, CheckCircle2, Package, RefreshCw,
  TrendingUp, Download, QrCode as QrCodeIcon, Printer, Banknote,
} from 'lucide-react';
import { InfinityHeart, QrCode } from './ui';

// Staff-only screens. Lazy so the customer bundle never carries the till.
const PosPage = lazy(() => import('./pos').then(m => ({ default: m.PosPage })));
const KioskPage = lazy(() => import('./pos').then(m => ({ default: m.KioskPage })));
import {
  MENU, ADD_ONS, SIZES, sizeLabel, TAX_RATE, round2,
  formatLocalDate, toDisplayTime, parseLocalDate,
} from './menu';
import { subscribeToSlots, bookSlot, saveOrder, getPayableOrder } from './storage';
import { sendOrderEmails } from './email';
import {
  isSquareConfigured, initSquarePayments, initApplePay, tokenize, chargePayment,
} from './square';
import { sendLoginCode, verifyLoginCode, onAuthChange, signOut, displayName } from './auth';
import {
  STAMPS_FOR_REWARD, getLoyaltyBalance, getLoyaltyHistory, getMyOrders,
  getFavorites, addFavorite, removeFavorite, claimOrder,
} from './loyalty';
import {
  amIAdmin, myRole, getStoreSettings, updateStoreSettings, subscribeToStoreSettings,
  getOrdersForDate, setOrderFulfilled, subscribeToOrders, getOrdersInRange,
} from './admin';

// ═══════════════════════════════════════════════════════
// PUBLIC BUSINESS CONFIG (read from env)
// ═══════════════════════════════════════════════════════
const BUSINESS = {
  name: 'Iced Intentions',
  phone: import.meta.env.VITE_BUSINESS_PHONE || '(972) 555-0142',
  address: import.meta.env.VITE_BUSINESS_ADDRESS || '1247 Las Colinas Blvd, Irving, TX 75039',
  instagram: import.meta.env.VITE_BUSINESS_INSTAGRAM || '@iced.intentions_',
  hours: {
    wednesday: '6:00 – 9:00 AM',
    friday: '6:00 – 9:00 AM',
  },
};
// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

// ── PICKUP SCHEDULE ────────────────────────────────────
// Only these weekdays are open, each with its own hours. 15-min slots,
// and each slot can hold up to SLOT_CAPACITY orders.
// getDay(): 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
const SLOT_CAPACITY = 2;
const PICKUP_SCHEDULE = {
  3: { start: '06:00', end: '09:00' }, // Wednesday  6:00am – 9:00am
  5: { start: '06:00', end: '09:00' }, // Friday     6:00am – 9:00am
};

// Time slots for a given pickup date (based on that day's schedule).
const generateTimeSlotsForDate = (iso) => {
  if (!iso) return [];
  const weekday = parseLocalDate(iso).getDay();
  const cfg = PICKUP_SCHEDULE[weekday];
  if (!cfg) return [];
  const [sh, sm] = cfg.start.split(':').map(Number);
  const [eh, em] = cfg.end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const slots = [];
  for (let t = startMin; t <= endMin; t += 15) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    slots.push({ time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, display: toDisplayTime(h, m) });
  }
  return slots;
};

// ── ORDER CUTOFF ───────────────────────────────────────
// Orders for a pickup day close at 7:00 PM the evening before, so the
// day's list is final with a full evening left to prep from it.
//
// Because pickup is only ever 6–9 AM, this also means same-day ordering
// is never possible: by the time a pickup day starts, its cutoff passed
// eleven hours earlier. That's intentional, not a side effect.
const ORDER_CUTOFF_HOUR = 19;

// The instant ordering closes for a given pickup date.
const cutoffForDate = (iso) => {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() - 1);
  d.setHours(ORDER_CUTOFF_HOUR, 0, 0, 0);
  return d;
};

const isDateOrderable = (iso, now = new Date()) => now.getTime() < cutoffForDate(iso).getTime();

// A friendly "order by …" line for a pickup date.
const cutoffLabel = (iso) => {
  const c = cutoffForDate(iso);
  return `${c.toLocaleDateString('en-US', { weekday: 'long' })} at ${toDisplayTime(c.getHours(), c.getMinutes())}`;
};

// The next open pickup days (Wed/Fri), looking a few weeks ahead.
// Days whose cutoff has passed are excluded — you can't order for them.
const getUpcomingPickupDays = (limit = 8, now = new Date()) => {
  const days = [];
  for (let i = 0; i < 28 && days.length < limit; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    if (!PICKUP_SCHEDULE[d.getDay()]) continue;
    const iso = formatLocalDate(d);
    if (!isDateOrderable(iso, now)) continue;
    days.push({
      iso,
      day: d.toLocaleDateString('en-US', { weekday: 'short' }),
      date: d.getDate(),
      month: d.toLocaleDateString('en-US', { month: 'short' }),
      isToday: false, // same-day ordering can't happen under the cutoff rule
    });
  }
  return days;
};

const getNextSevenDays = () => {
  const days = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({
      iso: formatLocalDate(d),
      day: d.toLocaleDateString('en-US', { weekday: 'short' }),
      date: d.getDate(),
      month: d.toLocaleDateString('en-US', { month: 'short' }),
      isToday: i === 0,
    });
  }
  return days;
};

// ═══════════════════════════════════════════════════════
// VISUAL COMPONENTS
// ═══════════════════════════════════════════════════════
const Ornament = ({ width = 200, color = '#5C3A21' }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width, margin: '0 auto' }}>
    <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: `1.5px solid ${color}`, flexShrink: 0 }} />
    <div style={{ flex: 1, height: '1px', borderTop: `1px dotted ${color}`, opacity: 0.6 }} />
    <svg width="32" height="14" viewBox="0 0 40 18" style={{ flexShrink: 0 }}>
      <path d="M 5 9 Q 10 2, 15 9 Q 20 16, 25 9 Q 30 2, 35 9" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
    <div style={{ flex: 1, height: '1px', borderTop: `1px dotted ${color}`, opacity: 0.6 }} />
    <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: `1.5px solid ${color}`, flexShrink: 0 }} />
  </div>
);

const DrinkVisual = ({ gradient, photo, size = 'md' }) => {
  const dims = size === 'xs' ? { w: 56, h: 90 } : size === 'sm' ? { w: 80, h: 130 } : size === 'lg' ? { w: 180, h: 280 } : { w: 130, h: 200 };

  // When a real photo exists, show it in a softly-rounded frame (object-fit
  // cover keeps the cup centered). Falls back to the stylized gradient cup.
  if (photo) {
    return (
      <div style={{ position: 'relative', width: dims.w, height: dims.h, display: 'inline-block' }}>
        <img
          src={photo}
          alt=""
          loading="lazy"
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            borderRadius: `${dims.w * 0.12}px`,
            boxShadow: '0 6px 20px rgba(42, 24, 16, 0.18)',
            display: 'block',
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: dims.w, height: dims.h, display: 'inline-block' }}>
      <div
        style={{
          position: 'absolute', inset: 0, background: gradient,
          borderRadius: `${dims.w * 0.08}px ${dims.w * 0.08}px ${dims.w * 0.15}px ${dims.w * 0.15}px / ${dims.h * 0.04}px ${dims.h * 0.04}px ${dims.h * 0.08}px ${dims.h * 0.08}px`,
          boxShadow: 'inset 0 -8px 20px rgba(0,0,0,0.08), inset 8px 0 12px rgba(255,255,255,0.15), 0 8px 24px rgba(42, 24, 16, 0.18)',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', left: '8%', top: '5%', bottom: '15%', width: '6%', background: 'linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0.05))', borderRadius: '50%', filter: 'blur(2px)' }} />
        <div style={{ position: 'absolute', inset: '20% 0 30% 0', background: 'radial-gradient(circle at 30% 40%, rgba(255,255,255,0.2) 4px, transparent 5px), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.15) 5px, transparent 6px), radial-gradient(circle at 50% 30%, rgba(255,255,255,0.1) 3px, transparent 4px)', opacity: 0.6 }} />
      </div>
      <div
        style={{
          position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%, -50%)',
          width: dims.w * 0.55, height: dims.w * 0.55,
          background: '#FFFEFA', borderRadius: '50%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.1)', padding: '4px',
        }}
      >
        <InfinityHeart size={dims.w * 0.18} color="#2A1810" />
        <div style={{ fontFamily: '"Pinyon Script", cursive', fontSize: `${dims.w * 0.11}px`, color: '#2A1810', lineHeight: 1, marginTop: '2px' }}>
          Iced Intentions
        </div>
      </div>
      <div style={{ position: 'absolute', top: -6, left: -4, right: -4, height: '14%', background: 'linear-gradient(180deg, rgba(232, 164, 184, 0.35), rgba(232, 164, 184, 0.15))', border: '1px solid rgba(255,255,255,0.5)', borderRadius: `${dims.w * 0.12}px ${dims.w * 0.12}px 4px 4px`, backdropFilter: 'blur(2px)' }} />
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// NAV
// ═══════════════════════════════════════════════════════
const Nav = ({ page, setPage, user, onAccount, onSignIn }) => {
  const [open, setOpen] = useState(false);
  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'order', label: 'Order' },
  ];

  return (
    <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(250, 241, 228, 0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(92, 58, 33, 0.12)' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <button onClick={() => setPage('home')} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, minWidth: 0, flexShrink: 1 }}>
          <InfinityHeart size={24} color="#2A1810" />
          <span style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(22px, 6vw, 28px)', color: '#2A1810', lineHeight: 1, whiteSpace: 'nowrap' }}>
            Iced Intentions
          </span>
        </button>

        <div className="nav-desktop" style={{ alignItems: 'center', gap: '36px' }}>
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              style={{
                background: 'none', border: 'none',
                fontFamily: '"Cormorant Garamond", serif',
                fontSize: '17px', letterSpacing: '0.08em', textTransform: 'uppercase',
                color: page === item.id ? '#2A1810' : '#5C3A21',
                fontWeight: page === item.id ? 600 : 400,
                cursor: 'pointer', position: 'relative', padding: '4px 0',
              }}
            >
              {item.label}
              {page === item.id && (
                <div style={{ position: 'absolute', bottom: -2, left: 0, right: 0, height: '1px', background: '#E8A4B8' }} />
              )}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {/* Account / Sign-in (desktop) */}
          <button
            onClick={user ? onAccount : onSignIn}
            className="nav-cart-desktop"
            style={{
              alignItems: 'center', gap: '8px',
              background: 'transparent', color: '#2A1810',
              padding: '9px 16px', borderRadius: '999px', border: '1.5px solid rgba(92,58,33,0.25)',
              fontFamily: '"Outfit", sans-serif', fontSize: '12px',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              fontWeight: 500, cursor: 'pointer',
            }}
          >
            {user ? <><Gift size={14} /> My Card</> : <><User size={14} /> Sign In</>}
          </button>

          {/* Mobile: hamburger */}
          <div className="nav-mobile-controls">
            <button
              onClick={() => setOpen(!open)}
              data-compact
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Menu"
            >
              {open ? <X size={22} color="#2A1810" /> : <MenuIcon size={22} color="#2A1810" />}
            </button>
          </div>
        </div>
      </div>
      {open && (
        <div className="nav-mobile-menu" style={{ borderTop: '1px solid rgba(92, 58, 33, 0.12)', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '12px', background: '#FAF1E4' }}>
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setPage(item.id); setOpen(false); }}
              style={{
                background: 'none', border: 'none',
                fontFamily: '"Cormorant Garamond", serif', fontSize: '20px',
                color: page === item.id ? '#2A1810' : '#5C3A21',
                fontWeight: page === item.id ? 600 : 400,
                textAlign: 'left', padding: '8px 0', cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          ))}
          <div style={{ borderTop: '1px solid rgba(92,58,33,0.12)', paddingTop: '12px', marginTop: '4px' }}>
            <button
              onClick={() => { setOpen(false); user ? onAccount() : onSignIn(); }}
              style={{
                background: 'none', border: 'none',
                fontFamily: '"Cormorant Garamond", serif', fontSize: '20px',
                color: '#2A1810', fontWeight: 600,
                textAlign: 'left', padding: '8px 0', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '10px',
              }}
            >
              {user ? <><Gift size={18} /> My Loyalty Card</> : <><User size={18} /> Sign In / Join</>}
            </button>
          </div>
        </div>
      )}
    </nav>
  );
};

// ═══════════════════════════════════════════════════════
// HOME PAGE
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// HOMEPAGE
// ───────────────────────────────────────────────────────
// PLACEHOLDER reviews — replace the quote/name of each with REAL
// customer reviews before relying on this as social proof. Do not
// publish these sample lines as if they were real testimonials.
// Real customer feedback (paraphrased from what people have said in person /
// on Instagram). Swap a descriptor for a real first name + initial whenever you
// know who said it — named reviews read as even more credible.
const REVIEWS = [
  { quote: "Best coffee in town — hands down.", name: 'A Bakersfield local', tag: 'Regular' },
  { quote: "Almost too pretty to drink… and it tasted even better than it looked.", name: 'A first-timer', tag: 'Now obsessed' },
  { quote: "I stopped going to other coffee shops after my first drink here.", name: 'A convert', tag: "Won't go elsewhere" },
];

// A few real drink photos for the "follow along" gallery.
const HOME_GALLERY = [
  '/drinks/matcha-rosa-v2.jpeg', '/drinks/coquetta-crush-v2.jpeg', '/drinks/azulita-fuse.jpeg',
  '/drinks/sunkissed-cielo-v2.jpeg', '/drinks/cremita-fuse.jpeg', '/drinks/verde-fuse.jpeg',
];

// ═══════════════════════════════════════════════════════
// NEW ARRIVAL
// ───────────────────────────────────────────────────────
// Reads whichever drink carries isNew rather than hardcoding one, so
// flagging the next new drink in menu.js is the only step needed — and
// the banner disappears by itself when nothing is flagged.
// ═══════════════════════════════════════════════════════
const NewArrivalBanner = ({ onOrderDrink }) => {
  const drink = useMemo(
    () => Object.values(MENU).flatMap(c => c.items).find(d => d.isNew),
    [],
  );
  if (!drink) return null;

  return (
    <section className="section-pad-sm" style={{ background: '#FAF1E4' }}>
      <div className="new-arrival">
        <div className="new-arrival-photo">
          {drink.photo
            ? <img src={drink.photo} alt={drink.name} loading="lazy" />
            : <div style={{ width: '100%', height: '100%', background: drink.gradient }} />}
          <span className="new-arrival-chip">Just landed</span>
        </div>

        <div className="new-arrival-copy">
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.32em', textTransform: 'uppercase', color: '#E8A4B8', fontWeight: 600 }}>
            New Arrival
          </span>
          <h2 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(44px, 7vw, 78px)', color: '#FAF1E4', margin: '6px 0 0 0', fontWeight: 400, lineHeight: 0.95 }}>
            {drink.name}
          </h2>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: 'clamp(17px, 2.4vw, 21px)', color: 'rgba(250,241,228,0.86)', margin: '14px 0 0 0', lineHeight: 1.5, maxWidth: '38ch' }}>
            {drink.desc}.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap', marginTop: '26px' }}>
            <button onClick={() => onOrderDrink(drink.id)}
              style={{ background: '#E8A4B8', color: '#2A1810', padding: '16px 32px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
              Order it now <ChevronRight size={15} />
            </button>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#FAF1E4', fontWeight: 600 }}>
              ${drink.priceL.toFixed(2)}
              <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.7, marginLeft: '8px' }}>
                {drink.singleSize ? '32 oz' : 'Large'}
              </span>
            </span>
          </div>
        </div>

        <Sparkles size={20} style={{ position: 'absolute', top: '22px', right: '26px', color: 'rgba(232,164,184,0.55)' }} />
      </div>
    </section>
  );
};

const HomePage = ({ setPage, onSignIn, user, onOrderDrink }) => {
  const featured = [
    { ...MENU.matcha.items[3], category: 'Matcha' },
    { ...MENU.lattes.items[1], category: 'Latte' },
    { ...MENU.refreshers.items[2], category: 'Refresher' },
    { ...MENU.energy.items[2], category: 'Energy' },
  ];

  return (
    <div>
      {/* HERO */}
      <section style={{ position: 'relative', minHeight: '85vh', display: 'flex', alignItems: 'center', overflow: 'hidden', background: 'radial-gradient(ellipse at top right, rgba(232, 164, 184, 0.15), transparent 60%), radial-gradient(ellipse at bottom left, rgba(181, 201, 154, 0.12), transparent 60%), #FAF1E4' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.4, backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\'/%3E%3CfeColorMatrix values=\'0 0 0 0 0.4 0 0 0 0 0.3 0 0 0 0 0.2 0 0 0 0.5 0\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.4\'/%3E%3C/svg%3E")' }} />

        <div className="grid-2-md" style={{ maxWidth: '1280px', margin: '0 auto', padding: '40px 20px', position: 'relative', alignItems: 'center', width: '100%' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ width: '32px', height: '1px', background: '#5C3A21' }} />
              <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>
                Coffee · Energy · More
              </span>
            </div>
            <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(42px, 11vw, 128px)', lineHeight: 0.95, color: '#2A1810', margin: '0 0 8px 0', fontWeight: 400 }}>
              Iced<br />Intentions
            </h1>
            <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: 'clamp(16px, 4.5vw, 24px)', color: '#5C3A21', maxWidth: '480px', lineHeight: 1.5, margin: '20px 0 28px 0' }}>
              Every drink is a tiny love letter — poured slow, layered with care, sealed with a soft top and a kiss of intention.
            </p>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button onClick={() => setPage('order')} style={{ background: '#2A1810', color: '#FAF1E4', padding: '14px 28px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.3s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#5C3A21'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#2A1810'; }}>
                Order Online <ChevronRight size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: '24px', marginTop: '36px', flexWrap: 'wrap' }}>
              {[
                { num: '4+', label: 'Signature Matchas' },
                { num: '16', label: 'Crafted Drinks' },
                { num: '∞', label: 'Custom' },
              ].map(stat => (
                <div key={stat.label}>
                  <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(28px, 7vw, 40px)', color: '#2A1810', lineHeight: 1, fontWeight: 500 }}>{stat.num}</div>
                  <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21', marginTop: '4px' }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '380px', marginTop: '20px' }}>
            {/* Back-left: Matcha Rosa */}
            <div style={{ position: 'absolute', top: '4%', left: '8%', transform: 'rotate(-7deg)', width: 'clamp(120px, 20vw, 168px)', aspectRatio: '4 / 5', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 14px 36px rgba(42,24,16,0.18)', zIndex: 1 }}>
              <img src="/drinks/matcha-rosa-v2.jpeg" alt="Matcha Rosa" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            {/* Center: Mornenita Mornings (hero) */}
            <div style={{ position: 'relative', zIndex: 2, width: 'clamp(170px, 30vw, 240px)', aspectRatio: '4 / 5', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 24px 60px rgba(42,24,16,0.28)' }}>
              <img src="/drinks/mornenita-mornings-v3.jpeg" alt="Mornenita Mornings" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            {/* Back-right: Azulita Fuse */}
            <div style={{ position: 'absolute', bottom: '4%', right: '6%', transform: 'rotate(8deg)', width: 'clamp(120px, 20vw, 168px)', aspectRatio: '4 / 5', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 14px 36px rgba(42,24,16,0.18)', zIndex: 1 }}>
              <img src="/drinks/azulita-fuse.jpeg" alt="Azulita Fuse" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            <Sparkles size={20} style={{ position: 'absolute', top: '10%', right: '16%', color: '#E8A4B8', zIndex: 3 }} />
            <Heart size={15} style={{ position: 'absolute', bottom: '16%', left: '12%', color: '#E8A4B8', fill: '#E8A4B8', zIndex: 3 }} />
          </div>
        </div>
      </section>

      <NewArrivalBanner onOrderDrink={onOrderDrink} />

      {/* STORY */}
      <section className="section-pad" style={{ background: '#F0E2C9', position: 'relative' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <Ornament width={240} />
          <h2 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(40px, 9vw, 80px)', color: '#2A1810', margin: '20px 0 8px 0', fontWeight: 400, lineHeight: 1 }}>
            our little story
          </h2>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(16px, 4vw, 22px)', lineHeight: 1.7, color: '#3D2817', margin: '24px 0', fontStyle: 'italic' }}>
            Iced Intentions was created from a love of cafecito, creativity, and bringing people together. Every drink is handcrafted with intention, inspired by comfort, conversation, and the little moments that make life sweeter. Whether you're a coffee lover, a matcha enthusiast, or just stopping by for something refreshing, we hope every cup feels like it was made just for you.
          </p>
          <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21', marginTop: '32px' }}>
            — Made in Bakersfield, with mucho amor —
          </p>
        </div>
      </section>

      {/* SIGNATURES */}
      <section className="section-pad" style={{ background: '#FAF1E4' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>
              Signature Sips
            </span>
            <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(32px, 7vw, 56px)', color: '#2A1810', margin: '12px 0 0 0', fontWeight: 500, letterSpacing: '-0.02em' }}>
              Made with Intention
            </h2>
          </div>

          <div className="grid-4-md">
            {featured.map(drink => (
              <div
                key={drink.id}
                onClick={() => setPage('order')}
                style={{ background: '#FFFEFA', padding: '0', borderRadius: '12px', textAlign: 'center', position: 'relative', transition: 'transform 0.4s, box-shadow 0.4s', cursor: 'pointer', boxShadow: '0 1px 3px rgba(42, 24, 16, 0.06)', border: '1px solid rgba(92, 58, 33, 0.08)', overflow: 'hidden' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-6px)';
                  e.currentTarget.style.boxShadow = '0 12px 32px rgba(42, 24, 16, 0.12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(42, 24, 16, 0.06)';
                }}
              >
                <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 5', overflow: 'hidden', background: drink.photo ? '#EDE4D3' : drink.gradient }}>
                  {drink.photo ? (
                    <img src={drink.photo} alt={drink.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <DrinkVisual gradient={drink.gradient} size="md" />
                    </div>
                  )}
                  <span style={{ position: 'absolute', top: '12px', left: '12px', fontFamily: '"Outfit", sans-serif', fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#2A1810', fontWeight: 600, background: 'rgba(255,254,250,0.92)', backdropFilter: 'blur(6px)', borderRadius: '999px', padding: '5px 10px' }}>{drink.category}</span>
                </div>
                <div style={{ padding: '18px 16px 22px 16px' }}>
                  <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', color: '#2A1810', margin: '0 0 8px 0', fontWeight: 500, fontStyle: 'italic' }}>{drink.name}</h3>
                  <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', lineHeight: 1.5, margin: '0 0 14px 0', minHeight: '36px' }}>{drink.desc}</p>
                  <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', color: '#2A1810', fontWeight: 600 }}>${drink.priceL.toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: '40px' }}>
            <button onClick={() => setPage('order')} style={{ background: 'transparent', border: 'none', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '20px', color: '#2A1810', cursor: 'pointer', borderBottom: '1px solid #2A1810', paddingBottom: '4px' }}>
              Browse the full menu →
            </button>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS — social proof */}
      <section className="section-pad" style={{ background: '#F0E2C9' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '44px' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>
              Loved in Bakersfield
            </span>
            <h2 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(40px, 9vw, 76px)', color: '#2A1810', margin: '8px 0 0 0', fontWeight: 400, lineHeight: 1 }}>
              little love notes
            </h2>
          </div>
          <div className="grid-3-md">
            {REVIEWS.map((r, i) => (
              <div key={i} style={{ background: '#FFFEFA', borderRadius: '16px', padding: '30px 26px', border: '1px solid rgba(92,58,33,0.08)', boxShadow: '0 1px 3px rgba(42,24,16,0.05)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ color: '#E8A4B8', fontSize: '15px', letterSpacing: '2px', marginBottom: '14px' }}>★★★★★</div>
                <p style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '19px', fontStyle: 'italic', lineHeight: 1.5, color: '#2A1810', margin: '0 0 18px 0', flex: 1 }}>
                  “{r.quote}”
                </p>
                <div>
                  <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em', color: '#2A1810' }}>{r.name}</div>
                  <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#5C3A21', marginTop: '2px' }}>{r.tag}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MENU */}
      <section className="section-pad-sm" style={{ background: '#2A1810', color: '#FAF1E4' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <h2 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(40px, 8vw, 72px)', margin: 0, fontWeight: 400, color: '#F0E2C9' }}>
              the menu
            </h2>
          </div>

          <div className="grid-2-md">
            {Object.entries(MENU).map(([key, cat]) => (
              <div key={key}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(240, 226, 201, 0.2)', paddingBottom: '12px', marginBottom: '20px' }}>
                  <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '26px', margin: 0, fontWeight: 500, letterSpacing: '0.02em' }}>{cat.title}</h3>
                  <div style={{ display: 'flex', gap: '32px' }}>
                    <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.7 }}>L</span>
                    <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.7 }}>Bucket</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {cat.items.map(item => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '20px' }}>
                      <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', fontStyle: 'italic' }}>{item.name}</span>
                      <div style={{ flex: 1, borderBottom: '1px dotted rgba(240, 226, 201, 0.3)', height: '1px', minWidth: '20px' }} />
                      <div style={{ display: 'flex', gap: '32px', flexShrink: 0 }}>
                        <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '14px' }}>${item.priceL.toFixed(2)}</span>
                        <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '14px', minWidth: '46px', textAlign: 'right' }}>${item.priceBucket.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {cat.note && (
                  <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', opacity: 0.7, marginTop: '16px' }}>* {cat.note}</p>
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop: '48px', borderTop: '1px solid rgba(240, 226, 201, 0.2)', paddingTop: '32px' }}>
            <h4 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', textAlign: 'center', margin: '0 0 16px 0', fontWeight: 500 }}>Add Ons</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', justifyContent: 'center' }}>
              {ADD_ONS.map(a => (
                <span key={a.id} style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', opacity: 0.85 }}>
                  {a.name} <span style={{ opacity: 0.6 }}>${a.price.toFixed(2)}</span>
                </span>
              ))}
            </div>
            <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', textAlign: 'center', opacity: 0.7, marginTop: '24px' }}>
              * All caffeine drinks come with soft top *
            </p>
          </div>
        </div>
      </section>

      {/* VISIT */}
      <section className="section-pad" style={{ background: '#FAF1E4' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div className="grid-2-md" style={{ alignItems: 'center' }}>
            <div>
              <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>Come See Us</span>
              <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(28px, 6vw, 52px)', color: '#2A1810', margin: '10px 0 28px 0', fontWeight: 500, letterSpacing: '-0.02em' }}>
                Visit our little corner
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {[
                  { Icon: MapPin, label: BUSINESS.address },
                  { Icon: Phone, label: BUSINESS.phone },
                  { Icon: Instagram, label: BUSINESS.instagram },
                ].map(({ Icon, label }, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#F0E2C9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={16} color="#2A1810" />
                    </div>
                    <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '15px', color: '#2A1810' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: '#F0E2C9', padding: '32px', borderRadius: '4px', position: 'relative', border: '1px solid rgba(92, 58, 33, 0.12)' }}>
              <Clock size={22} color="#2A1810" style={{ marginBottom: '12px' }} />
              <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '26px', color: '#2A1810', margin: '0 0 20px 0', fontWeight: 500 }}>Hours</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { day: 'Wednesday', hours: BUSINESS.hours.wednesday },
                  { day: 'Friday', hours: BUSINESS.hours.friday },
                  { day: 'Mon · Tue · Thu · Sat · Sun', hours: 'Closed' },
                ].map(row => (
                  <div key={row.day} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted rgba(92, 58, 33, 0.3)', paddingBottom: '8px', gap: '12px' }}>
                    <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', letterSpacing: '0.05em' }}>{row.day}</span>
                    <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#2A1810' }}>{row.hours}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* REWARDS — retention layer */}
      <section style={{ background: '#FAF1E4', padding: '0 20px 72px 20px' }}>
        <div style={{ maxWidth: '1080px', margin: '0 auto', background: 'linear-gradient(135deg, #2A1810 0%, #5C3A21 100%)', borderRadius: '24px', padding: 'clamp(36px, 6vw, 60px)', position: 'relative', overflow: 'hidden', textAlign: 'center' }}>
          <Sparkles size={20} style={{ position: 'absolute', top: '22px', right: '26px', color: 'rgba(232,164,184,0.6)' }} />
          <Heart size={14} style={{ position: 'absolute', bottom: '24px', left: '28px', color: 'rgba(232,164,184,0.5)', fill: 'rgba(232,164,184,0.5)' }} />
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#E8A4B8' }}>
            The Iced Intentions Club
          </span>
          <h2 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(38px, 8vw, 68px)', color: '#FAF1E4', margin: '10px 0 6px 0', fontWeight: 400, lineHeight: 1 }}>
            every cup earns a little love
          </h2>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(17px, 3.5vw, 21px)', fontStyle: 'italic', color: 'rgba(250,241,228,0.85)', maxWidth: '560px', margin: '0 auto 26px auto', lineHeight: 1.5 }}>
            Collect a stamp on every online order. Your 11th drink is on us — a little thank-you for coming back.
          </p>
          <button
            onClick={() => (user ? setPage('dashboard') : (onSignIn ? onSignIn() : setPage('order')))}
            style={{ background: '#E8A4B8', color: '#2A1810', padding: '15px 34px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            {user ? 'View your card' : 'Join the club'} <ChevronRight size={15} />
          </button>
        </div>
      </section>

      {/* GALLERY — follow along / social */}
      <section className="section-pad-sm" style={{ background: '#F0E2C9' }}>
        <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '36px' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>
              Follow along
            </span>
            <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(30px, 6vw, 50px)', color: '#2A1810', margin: '10px 0 0 0', fontWeight: 500, letterSpacing: '-0.02em' }}>
              {BUSINESS.instagram}
            </h2>
          </div>
          <div className="gallery-grid">
            {HOME_GALLERY.map((src, i) => (
              <a key={i} href={`https://instagram.com/${BUSINESS.instagram.replace('@','')}`} target="_blank" rel="noopener noreferrer"
                 className="gallery-cell" aria-label="Open our Instagram">
                <img src={src} alt="Iced Intentions drink" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <span className="gallery-overlay"><Instagram size={22} color="#FFFEFA" /></span>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
// ═══════════════════════════════════════════════════════
// CHECKOUT INPUT
// ═══════════════════════════════════════════════════════
const CheckoutInput = ({ label, value, onChange, placeholder, type = 'text' }) => (
  <div style={{ minWidth: 0, maxWidth: '100%' }}>
    <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '4px' }}>{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', maxWidth: '100%', minWidth: 0, padding: '10px 12px', borderRadius: '4px', border: '1.5px solid rgba(92, 58, 33, 0.2)', background: '#FAF1E4', fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810', outline: 'none', height: '44px', boxSizing: 'border-box', display: 'block' }}
      onFocus={(e) => e.target.style.borderColor = '#E8A4B8'}
      onBlur={(e) => e.target.style.borderColor = 'rgba(92, 58, 33, 0.2)'}
    />
  </div>
);

// ═══════════════════════════════════════════════════════
// DRINK CUSTOMIZER MODAL
// ═══════════════════════════════════════════════════════
const DrinkCustomizer = ({ drink, origin, onClose, onAdd, user, onSignIn }) => {
  const panelRef = useRef(null);
  const flipRef = useRef('');
  const [closing, setClosing] = useState(false);

  const reducedMotion = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // FLIP: the card is already on screen, so rather than fading a panel in
  // from nowhere we measure where it sits, start the popup mapped exactly
  // onto it, and let it grow into place. The popup then dismisses back
  // along the same path — things should leave the way they arrived.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    document.body.style.overflow = 'hidden';
    if (!origin || reducedMotion) return () => { document.body.style.overflow = ''; };

    const final = panel.getBoundingClientRect();
    // Uniform scale: scaling x and y independently would visibly stretch
    // the type on the way in.
    const scale = Math.max(0.1, origin.width / final.width);
    const dx = (origin.left + origin.width / 2) - (final.left + final.width / 2);
    const dy = (origin.top + origin.height / 2) - (final.top + final.height / 2);
    const flip = `translate(${dx}px, ${dy}px) scale(${scale})`;
    flipRef.current = flip;

    panel.style.transition = 'none';
    panel.style.transform = flip;
    panel.style.opacity = '0.35';
    panel.getBoundingClientRect(); // flush before we animate away from it

    const raf = requestAnimationFrame(() => {
      // Critically damped: a tap carries no momentum, so overshoot would
      // read as decoration rather than physics.
      panel.style.transition = 'transform 480ms cubic-bezier(0.32, 0.72, 0, 1), opacity 260ms ease-out';
      panel.style.transform = 'none';
      panel.style.opacity = '1';
    });
    return () => { cancelAnimationFrame(raf); document.body.style.overflow = ''; };
  }, []); // eslint-disable-line

  // Dismiss back into the card it came from.
  const playExit = (then) => {
    if (closing) return;
    setClosing(true);
    const panel = panelRef.current;
    if (panel && flipRef.current && !reducedMotion) {
      // Transitioning from whatever is on screen right now, so grabbing
      // Close mid-open reverses smoothly instead of jumping.
      panel.style.transition = 'transform 340ms cubic-bezier(0.4, 0, 0.2, 1), opacity 260ms ease-in';
      panel.style.transform = flipRef.current;
      panel.style.opacity = '0';
    }
    setTimeout(then, reducedMotion ? 140 : 300);
  };

  const close = () => playExit(onClose);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line

  const [size, setSize] = useState(drink.singleSize ? 'BUCKET' : 'L');
  const [addOns, setAddOns] = useState([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [savingFav, setSavingFav] = useState(false);
  const [favSaved, setFavSaved] = useState(false);

  const toggleAddOn = (id) => setAddOns(addOns.includes(id) ? addOns.filter(a => a !== id) : [...addOns, id]);

  const basePrice = size === 'L' ? drink.priceL : drink.priceBucket;
  const addOnTotal = addOns.reduce((s, id) => s + (ADD_ONS.find(a => a.id === id)?.price || 0), 0);
  const total = (basePrice + addOnTotal) * qty;

  // Build a self-contained snapshot of this customization for favorites.
  const buildFavoriteDrink = () => ({
    id: drink.id,
    name: drink.name,
    desc: drink.desc,
    category: drink.category,
    gradient: drink.gradient,
    photo: drink.photo || null,
    priceL: drink.priceL,
    priceBucket: drink.priceBucket,
    size,
    addOns,
    addOnsData: addOns.map(id => ADD_ONS.find(a => a.id === id)).filter(Boolean),
    qty,
    notes,
  });

  const handleSaveFavorite = async () => {
    if (!user) { onSignIn?.(); return; }
    setSavingFav(true);
    try {
      await addFavorite(user.id, buildFavoriteDrink(), drink.name);
      setFavSaved(true);
      setTimeout(() => setFavSaved(false), 2500);
    } catch (e) {
      console.warn('Save favorite failed:', e);
    } finally {
      setSavingFav(false);
    }
  };

  return (
    <div className={`popover-overlay${closing ? ' is-closing' : ''}`} onClick={close}>
      <div className="popover-card" ref={panelRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={drink.name}>
        <button onClick={close} style={{ position: 'absolute', top: '14px', right: '14px', background: 'rgba(255, 254, 250, 0.95)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 3, boxShadow: '0 2px 10px rgba(42,24,16,0.18)' }} aria-label="Close">
          <X size={20} color="#2A1810" />
        </button>
        {/* Hero: full, uncropped drink photo */}
        <div style={{ background: drink.photo ? '#EDE4D3' : drink.gradient, display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
          {drink.photo ? (
            <div style={{ width: '100%', aspectRatio: '4 / 5' }}>
              <img src={drink.photo} alt={drink.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          ) : (
            <div style={{ padding: '36px 20px 24px 20px' }}>
              <DrinkVisual gradient={drink.gradient} size="md" />
            </div>
          )}
        </div>
        <div style={{ padding: '24px 24px 28px 24px' }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(26px, 6vw, 32px)', color: '#2A1810', margin: '0 0 8px 0', fontWeight: 500, fontStyle: 'italic' }}>{drink.name}</h2>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#5C3A21', margin: '0 0 20px 0', lineHeight: 1.5 }}>{drink.desc}</p>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '10px' }}>Size</label>
            {drink.singleSize ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '14px 16px', borderRadius: '4px', border: '1.5px solid #2A1810', background: '#FFFEFA' }}>
                <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.06em', fontWeight: 500, color: '#2A1810' }}>32 oz — one size</span>
                <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', fontWeight: 600, color: '#2A1810' }}>${drink.priceL.toFixed(2)}</span>
              </div>
            ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              {SIZES.map(s => {
                const price = s.id === 'L' ? drink.priceL : drink.priceBucket;
                return (
                  <button key={s.id} onClick={() => setSize(s.id)}
                    style={{ flex: 1, padding: '14px 10px', borderRadius: '4px', border: `1.5px solid ${size === s.id ? '#2A1810' : 'rgba(92, 58, 33, 0.2)'}`, background: size === s.id ? '#2A1810' : '#FFFEFA', color: size === s.id ? '#FAF1E4' : '#2A1810', fontFamily: '"Outfit", sans-serif', cursor: 'pointer', transition: 'all 0.2s' }}>
                    <div style={{ fontSize: '12px', letterSpacing: '0.08em', fontWeight: 500 }}>{s.label}</div>
                    <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', marginTop: '4px', fontWeight: 600 }}>${price.toFixed(2)}</div>
                  </button>
                );
              })}
            </div>
            )}
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '10px' }}>Add Ons</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {ADD_ONS.map(a => (
                <button key={a.id} onClick={() => toggleAddOn(a.id)} data-compact
                  style={{ padding: '10px 14px', borderRadius: '999px', border: `1.5px solid ${addOns.includes(a.id) ? '#E8A4B8' : 'rgba(92, 58, 33, 0.2)'}`, background: addOns.includes(a.id) ? '#E8A4B8' : '#FFFEFA', color: '#2A1810', fontFamily: '"Outfit", sans-serif', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }}>
                  {addOns.includes(a.id) && <Check size={12} />}
                  {a.name} <span style={{ opacity: 0.7 }}>+${a.price.toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '8px' }}>Special Notes</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Less ice, extra sweet, custom print initials..."
              style={{ width: '100%', padding: '14px', borderRadius: '4px', border: '1.5px solid rgba(92, 58, 33, 0.2)', background: '#FFFEFA', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#2A1810', outline: 'none' }}
              onFocus={(e) => e.target.style.borderColor = '#E8A4B8'}
              onBlur={(e) => e.target.style.borderColor = 'rgba(92, 58, 33, 0.2)'} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={() => setQty(Math.max(1, qty - 1))} data-compact style={{ width: '40px', height: '40px', borderRadius: '50%', border: '1.5px solid rgba(92, 58, 33, 0.3)', background: '#FFFEFA', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-label="Decrease quantity">
                <Minus size={14} color="#2A1810" />
              </button>
              <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', minWidth: '32px', textAlign: 'center', fontWeight: 600 }}>{qty}</span>
              <button onClick={() => setQty(qty + 1)} data-compact style={{ width: '40px', height: '40px', borderRadius: '50%', border: '1.5px solid rgba(92, 58, 33, 0.3)', background: '#FFFEFA', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-label="Increase quantity">
                <Plus size={14} color="#2A1810" />
              </button>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Total</div>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '28px', color: '#2A1810', fontWeight: 600, lineHeight: 1 }}>${total.toFixed(2)}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={handleSaveFavorite} disabled={savingFav} data-compact
              title={user ? 'Save as favorite' : 'Sign in to save'}
              style={{ width: '54px', flexShrink: 0, background: favSaved ? '#E8A4B8' : 'transparent', color: '#2A1810', padding: '16px', border: `1.5px solid ${favSaved ? '#E8A4B8' : 'rgba(92,58,33,0.25)'}`, borderRadius: '999px', cursor: savingFav ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
              {savingFav
                ? <Loader2 size={16} className="spin" />
                : <Heart size={16} fill={favSaved ? '#2A1810' : 'none'} stroke="#2A1810" />}
            </button>
            <button onClick={() => playExit(() => onAdd(drink, size, addOns, qty, notes))} disabled={closing}
              style={{ flex: 1, background: '#2A1810', color: '#FAF1E4', padding: '16px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              <Plus size={14} /> Add to Cart
            </button>
          </div>
          {favSaved && (
            <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', color: '#5C3A21', textAlign: 'center', margin: '10px 0 0 0' }}>
              Saved to your favorites ♡
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// CHECKOUT FLOW
// ═══════════════════════════════════════════════════════
const CheckoutFlow = ({ cart, cartTotal, user, paused, inStore = false, onUpdateQty, onBack, onComplete }) => {
  const [selectedDate, setSelectedDate] = useState(getUpcomingPickupDays()[0]?.iso || '');
  const [selectedTime, setSelectedTime] = useState(null);
  const [bookedSlots, setBookedSlots] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [customerInfo, setCustomerInfo] = useState({
    name: user?.user_metadata?.full_name || user?.user_metadata?.name || '',
    phone: '',
    email: user?.email || '',
  });
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());

  // ── Payment state ──
  // Paying on the site is the ONLY way to order. If Square is unconfigured
  // or its form fails to load we block checkout outright rather than take
  // an order we have no way to collect payment for.
  const squareOn = isSquareConfigured();
  const [cardReady, setCardReady] = useState(false);
  const [payUnavailable, setPayUnavailable] = useState(!squareOn);
  const [cardObj, setCardObj] = useState(null);
  const [applePayObj, setApplePayObj] = useState(null);
  const cardMounted = useRef(false);

  // ── Loyalty redemption state ──
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [redeemOn, setRedeemOn] = useState(false);

  // Removing the last item here would otherwise leave them staring at an
  // empty checkout with a dead pay button.
  useEffect(() => {
    if (cart.length === 0) onBack();
  }, [cart.length]); // eslint-disable-line

  // Fetch the signed-in customer's stamp balance when checkout opens.
  useEffect(() => {
    let cancelled = false;
    if (user) {
      getLoyaltyBalance(user.id).then(b => { if (!cancelled) setLoyaltyBalance(b); });
    } else {
      setLoyaltyBalance(0); setRedeemOn(false);
    }
    return () => { cancelled = true; };
  }, [user]);

  const canRedeem = Boolean(user) && loyaltyBalance >= STAMPS_FOR_REWARD;

  // The free drink = the cheapest single drink (base price) in the cart.
  // Guard against a malformed cart item: one missing basePrice would turn
  // the whole total into NaN.
  const cheapestDrinkPrice = useMemo(() => {
    const prices = cart.map(i => Number(i.basePrice)).filter(p => Number.isFinite(p) && p > 0);
    if (prices.length === 0) return 0;
    return Math.min(...prices);
  }, [cart]);

  // Effective discount, tax and total when redemption is toggled on.
  // Mirrors process-payment: subtotal → less discount → plus tax on the rest.
  const discount = (canRedeem && redeemOn) ? cheapestDrinkPrice : 0;
  const taxableTotal = Math.max(0, round2(cartTotal - discount));
  const taxTotal = round2(taxableTotal * TAX_RATE);
  const effectiveTotal = round2(taxableTotal + taxTotal);
  const isFreeOrder = effectiveTotal <= 0 && (canRedeem && redeemOn);

  // Recomputed on every `now` tick so a day drops off the moment its 7 PM
  // cutoff passes, even if the customer has been sitting on this page.
  const days = useMemo(() => getUpcomingPickupDays(8, now), [now]);
  const allSlots = useMemo(() => generateTimeSlotsForDate(selectedDate), [selectedDate]);

  // If the selected day closes underneath them, move to the next open one.
  useEffect(() => {
    if (inStore || days.length === 0) return;
    if (!days.some(d => d.iso === selectedDate)) {
      setSelectedDate(days[0].iso);
      setSelectedTime(null);
      setError('Ordering just closed for that day. We\'ve moved you to the next available pickup.');
    }
  }, [days, selectedDate]);

  // Tick every 30 seconds so past slots disappear in near-real-time
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Real-time subscribe to slot updates for the selected date.
  // Skipped in store: no slot is reserved, and selectedDate may be empty.
  useEffect(() => {
    setBookedSlots({});
    if (inStore || !selectedDate) return;
    const unsubscribe = subscribeToSlots(selectedDate, (slots) => {
      setBookedSlots(slots);
    });
    return unsubscribe;
  }, [selectedDate, inStore]);

  // Initialize the Square card form once, on mount. The container below is
  // always rendered (only ever hidden with display:none for a fully-free
  // reward order) so the Square iframe is never torn out from under us.
  useEffect(() => {
    let cancelled = false;
    let localCard = null;
    if (!squareOn || cardMounted.current) return;

    (async () => {
      try {
        const { payments, card } = await initSquarePayments('si-card-container');
        if (cancelled) { try { await card.destroy(); } catch { /* noop */ } return; }
        cardMounted.current = true;
        localCard = card;
        setCardObj(card);
        setCardReady(true);
        setPayUnavailable(false);

        // Apple Pay (no-op today — disabled in square.js pending domain
        // verification). NOTE: when re-enabling, the sheet amount is fixed at
        // init, so it must be re-created whenever effectiveTotal changes.
        const ap = await initApplePay(payments, effectiveTotal);
        if (!cancelled && ap) setApplePayObj(ap);
      } catch (err) {
        console.error('Square init failed:', err);
        if (!cancelled) {
          setPayUnavailable(true);
          setCardReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (localCard) {
        cardMounted.current = false;
        try { localCard.destroy(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squareOn]);

  // A slot is full once it reaches capacity. booked_times stores a count
  // per time (older rows may store a name string — treat that as 1).
  const slotCount = (time) => {
    const v = bookedSlots[time];
    if (typeof v === 'number') return v;
    return v ? 1 : 0;
  };
  const isSlotTaken = (time) => slotCount(time) >= SLOT_CAPACITY;

  // BUFFER: customer can't pick a slot less than this many minutes from now.
  // Gives staff prep time + accounts for travel time.
  const PICKUP_BUFFER_MINUTES = 15;

  // Filter slots: past times (with buffer) are hidden when selectedDate is today.
  // For future dates, all slots show.
  const isSelectedDateToday = selectedDate === formatLocalDate(now);

  const visibleSlots = useMemo(() => {
    if (!isSelectedDateToday) return allSlots;
    const cutoff = new Date(now.getTime() + PICKUP_BUFFER_MINUTES * 60000);
    const cutoffMinutes = cutoff.getHours() * 60 + cutoff.getMinutes();
    return allSlots.filter(slot => {
      const [h, m] = slot.time.split(':').map(Number);
      return (h * 60 + m) > cutoffMinutes;
    });
  }, [allSlots, isSelectedDateToday, now]);

  // If currently-selected time becomes invalid (passes or gets taken), clear it
  useEffect(() => {
    if (!selectedTime) return;
    const stillValid = visibleSlots.find(s => s.time === selectedTime) && !isSlotTaken(selectedTime);
    if (!stillValid) setSelectedTime(null);
  }, [visibleSlots, selectedTime, bookedSlots]);

  // Shared validation before submitting.
  const validate = () => {
    setError('');
    if (!inStore && !selectedTime) { setError('Please choose a pickup time.'); return false; }
    if (!customerInfo.name || !customerInfo.phone) { setError('Name and phone are required.'); return false; }
    // Every order is paid on the site, so a real email is always required
    // for the receipt and confirmation.
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerInfo.email);
    if (!emailOk) { setError('A valid email is required for your receipt.'); return false; }
    return true;
  };

  // ── The one and only checkout path: pay by card on the site. ──
  // A fully-free reward order still runs through here, just without a card.
  const handlePayNow = async (paymentMethod) => {
    if (paused) { setError('Online ordering is paused right now. Please try again a little later. 🤍'); return; }
    if (payUnavailable) { setError('Card payments are temporarily unavailable. Please try again shortly.'); return; }
    if (!validate()) return;
    if (!isFreeOrder && !paymentMethod) { setError('Payment form is still loading. One moment...'); return; }

    setSubmitting(true);
    setError('');
    try {
      // 1. Tokenize the card (skipped entirely for a fully-free order).
      let token = null;
      if (!isFreeOrder) {
        token = await tokenize(paymentMethod);
      }

      // 2. Pre-generate the order id so the charge + order row match.
      const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      // 3. Book the slot BEFORE charging (don't charge for a slot that's gone).
      //    If the charge then fails, process-payment releases the slot and
      //    clears the pending row server-side, so a declined card doesn't
      //    silently eat one of the two spots for that time.
      //    In store there is no slot: they're already at the counter.
      if (!inStore) {
        await bookSlot(selectedDate, selectedTime, customerInfo.name);
      }

      // 4. Insert the order as 'pending'. The Edge Function flips it to 'paid'
      //    server-side after charging, and stores the real charged amount.
      const baseOrder = {
        id: orderId,
        placedAt: new Date().toISOString(),
        userId: user?.id || null,
        pickupDate: inStore ? formatLocalDate(new Date()) : selectedDate,
        pickupTime: inStore ? null : selectedTime,
        pickupTimeDisplay: inStore ? 'In-store' : allSlots.find(s => s.time === selectedTime)?.display,
        customer: customerInfo,
        items: cart,
        orderType: inStore ? 'instore' : 'pickup',
        // Provisional figures; the Edge Function recomputes all of these
        // server-side and overwrites the row with the authoritative values.
        subtotal: cartTotal,
        discount,
        tax: taxTotal,
        total: effectiveTotal,
        paymentStatus: 'pending',
        squarePaymentId: null,
        squareReceiptUrl: null,
      };
      await saveOrder(orderId, baseOrder);

      // 5. Charge via the Edge Function. It re-prices the cart from `items`
      //    against its own price list — the totals we send are display-only.
      const result = await chargePayment({
        sourceId: token,
        orderId,
        redeem: (canRedeem && redeemOn),
        items: cart.map(i => ({ drinkId: i.drinkId, size: i.size, qty: i.qty, addOns: i.addOns || [] })),
        buyerEmail: customerInfo.email,
        pickupDate: inStore ? formatLocalDate(new Date()) : selectedDate,
        pickupTime: inStore ? null : selectedTime,
        note: `Iced Intentions — ${cart.length} item(s), pickup ${selectedDate} ${selectedTime}`,
      });

      // 6. Build the final order object for the confirmation screen + emails.
      const order = {
        ...baseOrder,
        subtotal: result.subtotal != null ? result.subtotal : cartTotal,
        tax: result.tax != null ? result.tax : taxTotal,
        total: result.amountCharged != null ? result.amountCharged : effectiveTotal,
        discountApplied: result.discountApplied || 0,
        redeemed: Boolean(result.redeemed),
        paymentStatus: 'paid',
        squarePaymentId: result.paymentId,
        squareReceiptUrl: result.receiptUrl,
      };
      try { await sendOrderEmails(order); } catch (e) { console.warn('Email send failed:', e); }

      setSubmitting(false);
      onComplete(order);
    } catch (err) {
      setSubmitting(false);
      handleSubmitError(err);
    }
  };

  const handleSubmitError = (err) => {
    if (err.message === 'SLOT_TAKEN') {
      setError('That time was just booked by someone else. Please pick another.');
      setSelectedTime(null);
    } else if (err.message && err.message.includes('ORDERING_PAUSED')) {
      setError('Online ordering was just paused. Please try again a little later. 🤍');
    } else {
      setError(err.message || 'Something went wrong. Please try again.');
      console.error(err);
    }
  };

  // Free reward order needs no card; otherwise charge the mounted card.
  const handleSubmit = () => handlePayNow(isFreeOrder ? null : cardObj);

  // Checkout is blocked whenever we can't take money, or there's no open
  // pickup day left to book (every upcoming day's cutoff has passed).
  const checkoutBlocked = payUnavailable || paused || (!inStore && days.length === 0);
  const submitDisabled = submitting || checkoutBlocked || (!isFreeOrder && !cardReady);

  return (
    <div style={{ background: '#FAF1E4', minHeight: '100vh', overflowX: 'hidden', maxWidth: '100%' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 20px 150px 20px', width: '100%' }}>
        <button onClick={onBack} data-compact style={{ background: 'none', border: 'none', color: '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px', padding: '8px 0' }}>
          <ChevronLeft size={16} /> Back to menu
        </button>

        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>Checkout</span>
          <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(40px, 9vw, 72px)', color: '#2A1810', margin: '6px 0 0 0', fontWeight: 400, lineHeight: 1 }}>
            Almost yours
          </h1>
        </div>

        {inStore ? (
          <div style={{ background: '#2A1810', color: '#FAF1E4', padding: '18px 20px', borderRadius: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Coffee size={20} />
            <div>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '19px', fontStyle: 'italic', fontWeight: 600 }}>Paying at the counter</div>
              <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>
                No pickup time needed — pay here and collect your stamp.
              </div>
            </div>
          </div>
        ) : (
          <>
        <div style={{ background: '#FFFEFA', padding: '20px', borderRadius: '4px', marginBottom: '16px', border: '1px solid rgba(92, 58, 33, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Calendar size={18} color="#2A1810" />
            <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', color: '#2A1810', margin: 0, fontWeight: 500 }}>Pickup Date</h3>
          </div>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', color: '#5C3A21', margin: '0 0 14px 0' }}>
            {selectedDate
              ? `Orders for this day close ${cutoffLabel(selectedDate)}.`
              : 'Ordering is closed for now — please check back soon.'}
          </p>
          <div className="h-scroll-fade on-white">
            <div className="h-scroll">
              {days.map(d => (
                <button key={d.iso} onClick={() => { setSelectedDate(d.iso); setSelectedTime(null); }}
                  style={{ padding: '10px 14px', borderRadius: '4px', border: `1.5px solid ${selectedDate === d.iso ? '#2A1810' : 'rgba(92, 58, 33, 0.15)'}`, background: selectedDate === d.iso ? '#2A1810' : 'transparent', color: selectedDate === d.iso ? '#FAF1E4' : '#2A1810', cursor: 'pointer', textAlign: 'center', minWidth: '64px', transition: 'all 0.2s' }}>
                  <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '9px', letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.8 }}>{d.day}</div>
                  <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', fontWeight: 600, lineHeight: 1, marginTop: '4px' }}>{d.date}</div>
                  <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '9px', marginTop: '4px', opacity: 0.7 }}>{d.month}{d.isToday ? ' · Today' : ''}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ background: '#FFFEFA', padding: '20px', borderRadius: '4px', marginBottom: '16px', border: '1px solid rgba(92, 58, 33, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <Clock size={18} color="#2A1810" />
            <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', color: '#2A1810', margin: 0, fontWeight: 500 }}>Pickup Time</h3>
          </div>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', color: '#5C3A21', margin: '0 0 14px 0' }}>
            {isSelectedDateToday
              ? `15-minute windows · earliest pickup ${PICKUP_BUFFER_MINUTES} min from now.`
              : '15-minute windows. Taken slots disappear in real time.'}
          </p>

          {(() => {
            const openSlots = visibleSlots.filter(s => !isSlotTaken(s.time));
            if (openSlots.length === 0) {
              return (
                <p style={{ textAlign: 'center', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', color: '#5C3A21', padding: '20px 8px', margin: 0 }}>
                  {isSelectedDateToday
                    ? "We're closed for new orders today. Please pick another day."
                    : 'All time slots are booked for this day. Please pick another day.'}
                </p>
              );
            }
            return (
              <div style={{ display: 'grid', gap: '6px', gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))' }}>
                {openSlots.map(slot => {
                  const selected = selectedTime === slot.time;
                  const lastSpot = slotCount(slot.time) === SLOT_CAPACITY - 1;
                  return (
                    <button key={slot.time} onClick={() => setSelectedTime(slot.time)} data-compact
                      style={{ padding: '10px 6px', borderRadius: '3px', border: `1.5px solid ${selected ? '#E8A4B8' : 'rgba(92, 58, 33, 0.15)'}`, background: selected ? '#E8A4B8' : '#FAF1E4', color: '#2A1810', fontFamily: '"Outfit", sans-serif', fontSize: '12px', fontWeight: selected ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s', lineHeight: 1.3 }}>
                      {slot.display}
                      {lastSpot && <span style={{ display: 'block', fontSize: '8.5px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A83A56', marginTop: '2px' }}>1 left</span>}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>

          </>
        )}

        <div style={{ background: '#FFFEFA', padding: '20px', borderRadius: '4px', marginBottom: '16px', border: '1px solid rgba(92, 58, 33, 0.1)' }}>
          <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', color: '#2A1810', margin: '0 0 16px 0', fontWeight: 500 }}>Your Info</h3>
          <div style={{ display: 'grid', gap: '14px' }}>
            <CheckoutInput label="Full Name *" value={customerInfo.name} onChange={(v) => setCustomerInfo({ ...customerInfo, name: v })} />
            <CheckoutInput label="Phone *" value={customerInfo.phone} onChange={(v) => setCustomerInfo({ ...customerInfo, phone: v })} placeholder="(972) 555-0100" />
            <CheckoutInput label="Email *" value={customerInfo.email} onChange={(v) => setCustomerInfo({ ...customerInfo, email: v })} placeholder="for your receipt" type="email" />
          </div>
        </div>

        {/* ── PAYMENT ── */}
        <div style={{ background: '#FFFEFA', padding: '20px', borderRadius: '4px', marginBottom: '16px', border: '1px solid rgba(92, 58, 33, 0.1)' }}>
          <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', color: '#2A1810', margin: '0 0 14px 0', fontWeight: 500 }}>Payment</h3>

          {payUnavailable ? (
            /* Square is unconfigured or its form failed to load. We take no
               order we can't charge for — checkout is blocked outright. */
            <div style={{ background: 'rgba(232, 85, 122, 0.08)', border: '1px solid rgba(232, 85, 122, 0.3)', borderRadius: '8px', padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '6px' }}>
                <CreditCard size={17} color="#A83A56" />
                <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#A83A56', fontWeight: 600 }}>
                  Payments temporarily unavailable
                </span>
              </div>
              <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '16px', color: '#2A1810', margin: 0, lineHeight: 1.5 }}>
                We can't take card payments right now, so online ordering is paused. Please try again shortly — sorry for the detour. 🤍
              </p>
            </div>
          ) : (
            <>
              {/* Apple Pay button (only appears on supported Apple devices) */}
              {applePayObj && (
                <div style={{ marginBottom: '14px' }}>
                  <button
                    onClick={() => handlePayNow(applePayObj)}
                    disabled={submitting}
                    data-compact
                    style={{ width: '100%', height: '48px', background: '#000', color: '#fff', border: 'none', borderRadius: '6px', cursor: submitting ? 'wait' : 'pointer', fontFamily: '-apple-system, sans-serif', fontSize: '17px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    aria-label="Pay with Apple Pay"
                  >
                    Pay with  Pay
                  </button>
                  <div style={{ textAlign: 'center', margin: '12px 0', position: 'relative' }}>
                    <span style={{ background: '#FFFEFA', padding: '0 12px', position: 'relative', zIndex: 1, fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5C3A21' }}>or pay by card</span>
                    <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'rgba(92, 58, 33, 0.15)' }} />
                  </div>
                </div>
              )}

              {/* The card form is always mounted — only ever hidden with
                  display:none for a fully-free reward order — so the Square
                  iframe is never unmounted and re-created empty. */}
              <div style={{ display: isFreeOrder ? 'none' : 'block' }}>
                <div id="si-card-container" style={{ minHeight: '52px', marginBottom: '10px' }} />
                {!cardReady && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#5C3A21', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '14px' }}>
                    <Loader2 size={14} className="spin" /> Loading secure card form...
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '4px', color: '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '11px' }}>
                  <Lock size={11} /> Secured by Square · we never see your card number
                </div>
              </div>

              {isFreeOrder && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#F0E2C9', borderRadius: '8px', padding: '14px 16px' }}>
                  <Gift size={20} color="#2A1810" />
                  <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', fontStyle: 'italic', color: '#2A1810' }}>
                    Your reward covers this order — no payment needed!
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── LOYALTY REWARD REDEMPTION ── */}
        {canRedeem && !payUnavailable && (
          <div style={{ background: redeemOn ? 'linear-gradient(135deg, #2A1810, #5C3A21)' : '#FFFEFA', padding: '18px 20px', borderRadius: '12px', marginBottom: '16px', border: redeemOn ? 'none' : '1.5px solid #E8A4B8', transition: 'all 0.3s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: redeemOn ? '#E8A4B8' : '#F0E2C9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Gift size={20} color="#2A1810" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '19px', fontWeight: 600, color: redeemOn ? '#FAF1E4' : '#2A1810', fontStyle: 'italic' }}>
                    Free drink reward
                  </div>
                  <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', color: redeemOn ? 'rgba(250,241,228,0.8)' : '#5C3A21' }}>
                    {redeemOn
                      ? `Your cheapest drink is on us (−$${cheapestDrinkPrice.toFixed(2)})`
                      : `You have ${loyaltyBalance} stamps — redeem one free drink`}
                  </div>
                </div>
              </div>
              <button onClick={() => setRedeemOn(!redeemOn)} data-compact
                style={{ flexShrink: 0, background: redeemOn ? '#E8A4B8' : '#2A1810', border: 'none', borderRadius: '999px', padding: '10px 18px', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer', color: redeemOn ? '#2A1810' : '#FAF1E4' }}>
                {redeemOn ? 'Remove' : 'Redeem'}
              </button>
            </div>
          </div>
        )}

        {/* ── YOUR ORDER ──────────────────────────────────────
            Item cards with the drink's own photo. Quantities are
            editable here: making someone go back to the menu to change
            a number is the kind of friction that loses a sale. */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
            <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', color: '#2A1810', margin: 0, fontWeight: 600 }}>
              Your order <span style={{ fontSize: '15px', color: '#5C3A21', fontWeight: 400 }}>({cart.reduce((s, i) => s + i.qty, 0)})</span>
            </h3>
            <button onClick={onBack} data-compact
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', border: '1.5px solid rgba(92,58,33,0.25)', borderRadius: '999px', padding: '9px 16px', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, color: '#5C3A21', cursor: 'pointer' }}>
              Add another <Plus size={13} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {cart.map(item => (
              <div key={item.id} style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '16px', padding: '12px', display: 'flex', alignItems: 'center', gap: '13px' }}>
                <div style={{ flexShrink: 0, width: '68px', height: '68px', borderRadius: '12px', overflow: 'hidden', background: item.photo ? '#EDE4D3' : item.gradient }}>
                  {item.photo && (
                    <img src={item.photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', fontStyle: 'italic', fontWeight: 600, color: '#2A1810', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </div>
                  <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', color: '#5C3A21', marginTop: '2px' }}>
                    {item.sizeDisplay || sizeLabel(item.drinkId, item.size)}
                    {item.addOns?.length > 0 && ` · ${item.addOns.map(id => ADD_ONS.find(a => a.id === id)?.name).filter(Boolean).join(', ')}`}
                  </div>
                  {item.notes && (
                    <div style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '12.5px', color: '#5C3A21', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      "{item.notes}"
                    </div>
                  )}
                  <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '17px', fontWeight: 600, color: '#2A1810', marginTop: '4px' }}>
                    ${item.lineTotal.toFixed(2)}
                  </div>
                </div>

                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button onClick={() => onUpdateQty(item.id, item.qty - 1)} data-compact
                    aria-label={item.qty === 1 ? `Remove ${item.name}` : `One fewer ${item.name}`}
                    style={{ width: '30px', height: '30px', borderRadius: '50%', border: '1.5px solid rgba(92,58,33,0.22)', background: '#FAF1E4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {item.qty === 1 ? <Trash2 size={12} color="#A83A56" /> : <Minus size={13} color="#2A1810" />}
                  </button>
                  <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', fontWeight: 600, color: '#2A1810', minWidth: '20px', textAlign: 'center' }}>{item.qty}</span>
                  <button onClick={() => onUpdateQty(item.id, item.qty + 1)} data-compact aria-label={`One more ${item.name}`}
                    style={{ width: '30px', height: '30px', borderRadius: '50%', border: '1.5px solid rgba(92,58,33,0.22)', background: '#FAF1E4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Plus size={13} color="#2A1810" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── TOTALS ── */}
        <div style={{ background: '#F0E2C9', padding: '18px 20px', borderRadius: '16px', marginBottom: '16px', border: '1px solid rgba(92, 58, 33, 0.12)' }}>
          {discount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
              <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#A83A56', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Gift size={13} /> Free drink reward
              </span>
              <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#A83A56', fontWeight: 600 }}>−${discount.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21' }}>Subtotal</span>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810' }}>${taxableTotal.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21' }}>
              Sales tax ({(TAX_RATE * 100).toFixed(2).replace(/\.?0+$/, '')}%)
            </span>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810' }}>${taxTotal.toFixed(2)}</span>
          </div>
          <div style={{ borderTop: '1px solid rgba(92, 58, 33, 0.22)', marginTop: '12px', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Total</span>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '30px', color: '#2A1810', fontWeight: 600 }}>${effectiveTotal.toFixed(2)}</span>
          </div>
        </div>

        {/* Order is final once placed — she preps from a closed list the
            evening before, so there's no window to change it afterwards.
            Irrelevant in store, where the drink is made there and then. */}
        {!inStore && <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: '#F0E2C9', border: '1px solid rgba(92,58,33,0.15)', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px' }}>
          <Lock size={15} color="#5C3A21" style={{ flexShrink: 0, marginTop: '2px' }} />
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#3D2817', margin: 0, lineHeight: 1.5 }}>
            <strong style={{ fontWeight: 600 }}>Please double-check your order.</strong> Once it's placed we can't add
            to it or change it — everything is prepped ahead from the day's final list.
          </p>
        </div>}

        {error && (
          <div style={{ background: 'rgba(232, 85, 122, 0.1)', border: '1px solid rgba(232, 85, 122, 0.3)', padding: '14px', borderRadius: '4px', marginBottom: '16px', fontFamily: '"Outfit", sans-serif', fontSize: '14px', color: '#A83A56' }}>
            {error}
          </div>
        )}

        <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', color: '#5C3A21', textAlign: 'center', margin: '4px 0 0 0' }}>
          {inStore
            ? "You'll get a receipt by email, and your stamp lands straight on your card."
            : "You'll get a receipt by email. We'll have your order ready right at your time."}
        </p>
      </div>

      {/* Sticky pay bar. The form runs long, so the amount and the action
          stay in reach instead of living at the bottom of a scroll. */}
      <div className="checkout-paybar">
        <div className="checkout-paybar-inner">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#5C3A21' }}>
              Total · {cart.reduce((s, i) => s + i.qty, 0)} {cart.reduce((s, i) => s + i.qty, 0) === 1 ? 'drink' : 'drinks'}
            </div>
            <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '28px', fontWeight: 600, color: '#2A1810', lineHeight: 1.1 }}>
              ${effectiveTotal.toFixed(2)}
            </div>
          </div>
          <button onClick={handleSubmit} disabled={submitDisabled}
            style={{ flex: 1, maxWidth: '340px', background: submitting ? '#5C3A21' : '#2A1810', color: '#FAF1E4', padding: '18px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600, cursor: submitDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', opacity: submitDisabled && !submitting ? 0.55 : 1, transition: 'opacity 0.2s, background 0.2s' }}>
            {submitting
              ? <><Loader2 size={16} className="spin" /> Processing...</>
              : checkoutBlocked
                ? <>Unavailable</>
                : isFreeOrder
                  ? <><Gift size={15} /> Place free order</>
                  : <><Lock size={14} /> Pay ${effectiveTotal.toFixed(2)}</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// ORDER CONFIRMATION
// ═══════════════════════════════════════════════════════
const OrderConfirmation = ({ order, onClose }) => (
  <div style={{ background: '#FAF1E4', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
    <div style={{ maxWidth: '600px', width: '100%', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', width: '80px', height: '80px', borderRadius: '50%', background: '#E8A4B8', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
        <Heart size={36} fill="#FFFEFA" color="#FFFEFA" />
      </div>
      <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(56px, 7vw, 80px)', color: '#2A1810', margin: '0 0 8px 0', fontWeight: 400, lineHeight: 1 }}>
        order received
      </h1>
      <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '20px', color: '#5C3A21', margin: '12px 0 32px 0' }}>
        Thank you, {order.customer.name.split(' ')[0]}. Your order is queued with love.
      </p>

      <div style={{ background: '#FFFEFA', padding: '28px', borderRadius: '4px', textAlign: 'left', marginBottom: '24px', border: '1px solid rgba(92, 58, 33, 0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Order #</span>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#2A1810', fontWeight: 500 }}>{order.id.slice(-8).toUpperCase()}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Pickup</span>
          <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '17px', color: '#2A1810', fontWeight: 600 }}>
            {new Date(order.pickupDate + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} · {order.pickupTimeDisplay}
          </span>
        </div>
        <div style={{ borderTop: '1px solid rgba(92, 58, 33, 0.15)', marginTop: '14px', paddingTop: '14px' }}>
          {order.items.map(item => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#2A1810', fontStyle: 'italic' }}>{item.qty}× {item.name}</span>
              <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '14px', color: '#2A1810' }}>${item.lineTotal.toFixed(2)}</span>
            </div>
          ))}
        </div>
        {order.discountApplied > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#A83A56', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Gift size={13} /> Free drink reward
            </span>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#A83A56', fontWeight: 600 }}>−${order.discountApplied.toFixed(2)}</span>
          </div>
        )}
        {order.tax > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21' }}>Sales tax</span>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#2A1810' }}>${Number(order.tax).toFixed(2)}</span>
          </div>
        )}
        <div style={{ borderTop: '1px solid rgba(92, 58, 33, 0.2)', marginTop: '14px', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>
            {order.paymentStatus === 'paid' ? 'Paid' : 'Total'}
          </span>
          <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', fontWeight: 600 }}>${order.total.toFixed(2)}</span>
        </div>
      </div>

      <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '14px', color: '#5C3A21', marginBottom: order.squareReceiptUrl ? '14px' : '24px' }}>
        {order.redeemed
          ? "Your reward's been used — enjoy it. We can't wait to see you."
          : "You're all paid up. We can't wait to see you."}
      </p>

      {order.squareReceiptUrl && (
        <p style={{ marginBottom: '24px' }}>
          <a href={order.squareReceiptUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#5C3A21', display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
            <CreditCard size={13} /> View your Square receipt
          </a>
        </p>
      )}

      <button onClick={onClose} style={{ background: '#2A1810', color: '#FAF1E4', padding: '14px 32px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer' }}>
        Order Again
      </button>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════
// IN-STORE LANDING  (reached by the printed counter QR, ?instore=1)
// ───────────────────────────────────────────────────────
// Scanning used to drop people straight onto the menu, which looks
// identical to just opening the site — no sign-in, no sign anything had
// happened, so the stamp (the entire point) was easy to miss. This is the
// screen the QR actually lands on: explain the offer, get them signed in,
// then hand them to the in-store menu.
// ═══════════════════════════════════════════════════════
const InStoreLanding = ({ user, onSignIn, onContinue }) => (
  <div style={{ background: '#FAF1E4', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
    <div style={{ maxWidth: '420px', width: '100%', textAlign: 'center' }}>
      <InfinityHeart size={46} color="#2A1810" />
      <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(46px, 13vw, 66px)', color: '#2A1810', margin: '6px 0 0 0', fontWeight: 400, lineHeight: 1 }}>
        earn a stamp
      </h1>
      <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '19px', color: '#5C3A21', margin: '14px 0 30px 0', lineHeight: 1.5 }}>
        Sign in, order and pay right here on your phone — every drink brings your free one closer.
      </p>

      <div style={{ background: 'linear-gradient(135deg, #2A1810, #5C3A21)', borderRadius: '18px', padding: '26px 22px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'left', marginBottom: '22px' }}>
          {[
            { n: '1', t: 'Sign in', d: 'One code by email — no password.' },
            { n: '2', t: 'Order & pay', d: 'Pay by card here instead of at the counter.' },
            { n: '3', t: 'Collect your stamp', d: 'Your 11th drink is on us.' },
          ].map(s => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'flex-start', gap: '13px' }}>
              <span style={{ flexShrink: 0, width: '26px', height: '26px', borderRadius: '50%', background: '#E8A4B8', color: '#2A1810', fontFamily: '"Outfit", sans-serif', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {s.n}
              </span>
              <span>
                <span style={{ display: 'block', fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', fontStyle: 'italic', fontWeight: 600, color: '#FAF1E4' }}>{s.t}</span>
                <span style={{ display: 'block', fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: 'rgba(250,241,228,0.75)', marginTop: '1px' }}>{s.d}</span>
              </span>
            </div>
          ))}
        </div>

        <button onClick={user ? onContinue : onSignIn}
          style={{ width: '100%', background: '#E8A4B8', color: '#2A1810', padding: '16px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px' }}>
          {user ? <>Start my order <ChevronRight size={15} /></> : <><User size={15} /> Sign in / Join</>}
        </button>
      </div>

      {/* Never block a sale on account creation — they just forgo the stamp. */}
      {!user && (
        <button onClick={onContinue} data-compact
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#5C3A21', textDecoration: 'underline' }}>
          Continue without an account
        </button>
      )}
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════
// CLAIM A STAMP  (reached by ?claim=<orderId>)
// ───────────────────────────────────────────────────────
// A cash sale at the till has no account attached, so the customer would
// otherwise get nothing toward their free drink. Staff show this QR after
// taking the money; they sign in and the stamp attaches to the order.
// ═══════════════════════════════════════════════════════
const ClaimStampPage = ({ orderId, user, onSignIn, onDone }) => {
  const [status, setStatus] = useState('idle'); // idle | working | done | error
  const [error, setError] = useState('');
  const tried = useRef(false);

  // Claim as soon as they're signed in — one fewer tap at the counter.
  useEffect(() => {
    if (!user || !orderId || tried.current) return;
    tried.current = true;
    setStatus('working');
    claimOrder(orderId)
      .then(() => setStatus('done'))
      .catch(err => { setError(err.message || 'Could not claim that stamp.'); setStatus('error'); });
  }, [user, orderId]);

  return (
    <PayShell>
      <div style={{ textAlign: 'center', padding: '26px 0' }}>
        <InfinityHeart size={40} color="#2A1810" />

        {status === 'done' ? (
          <>
            <div style={{ display: 'inline-flex', width: '74px', height: '74px', borderRadius: '50%', background: '#E8A4B8', alignItems: 'center', justifyContent: 'center', margin: '16px 0' }}>
              <Check size={34} color="#FFFEFA" />
            </div>
            <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '54px', color: '#2A1810', margin: '0 0 6px 0', fontWeight: 400, lineHeight: 1 }}>
              stamp added
            </h1>
            <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '18px', color: '#5C3A21', margin: '0 0 26px 0' }}>
              That one's on your card. Your 11th drink is on us.
            </p>
            <button onClick={onDone}
              style={{ background: '#2A1810', color: '#FAF1E4', padding: '14px 30px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
              View my card
            </button>
          </>
        ) : status === 'error' ? (
          <>
            <h1 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '26px', color: '#2A1810', margin: '16px 0 8px 0', fontWeight: 500 }}>
              Couldn't add that stamp
            </h1>
            <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '16px', color: '#5C3A21', margin: '0 0 24px 0' }}>
              {error}
            </p>
            <button onClick={onDone}
              style={{ background: '#2A1810', color: '#FAF1E4', padding: '13px 28px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
              Go to the menu
            </button>
          </>
        ) : !user ? (
          <>
            <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '52px', color: '#2A1810', margin: '8px 0 4px 0', fontWeight: 400, lineHeight: 1 }}>
              claim your stamp
            </h1>
            <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '18px', color: '#5C3A21', margin: '0 0 26px 0', lineHeight: 1.5 }}>
              Sign in and we'll add this drink to your card — one code by email, no password.
            </p>
            <button onClick={onSignIn}
              style={{ background: '#2A1810', color: '#FAF1E4', padding: '16px 34px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
              <User size={15} /> Sign in / Join
            </button>
          </>
        ) : (
          <div style={{ padding: '40px 0' }}><Loader2 size={26} className="spin" color="#5C3A21" /></div>
        )}
      </div>
    </PayShell>
  );
};

// ═══════════════════════════════════════════════════════
// SCAN TO PAY  (reached by ?pay=<orderId>)
// ───────────────────────────────────────────────────────
// The barista has already taken the order at the counter and built the
// charge; the customer scans it and pays on their phone so the purchase
// is tied to their account and earns a stamp. Nothing about the order can
// be changed here — process-payment prices it from the row the barista
// saved, not from anything this page sends.
// ═══════════════════════════════════════════════════════
// Defined at module scope on purpose. As a nested component it would be a
// NEW component type on every render, so React would unmount and rebuild
// this whole subtree each time — taking Square's card iframe with it and
// leaving the card entry blank.
const PayShell = ({ children }) => (
  <div style={{ background: '#FAF1E4', minHeight: '100vh', padding: '32px 20px 60px 20px' }}>
    <div style={{ maxWidth: '480px', margin: '0 auto' }}>{children}</div>
  </div>
);

const ScanToPayPage = ({ orderId, user, onSignIn, onDone }) => {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [cardObj, setCardObj] = useState(null);
  const [payUnavailable, setPayUnavailable] = useState(!isSquareConfigured());
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [redeemOn, setRedeemOn] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const cardMounted = useRef(false);

  useEffect(() => {
    let alive = true;
    getPayableOrder(orderId).then(row => {
      if (!alive) return;
      setOrder(row);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [orderId]);

  useEffect(() => {
    let alive = true;
    if (user) getLoyaltyBalance(user.id).then(b => { if (alive) setLoyaltyBalance(b); });
    else { setLoyaltyBalance(0); setRedeemOn(false); }
    return () => { alive = false; };
  }, [user]);

  const items = order?.items || [];
  const subtotal = Number(order?.subtotal ?? 0);
  const canRedeem = Boolean(user) && loyaltyBalance >= STAMPS_FOR_REWARD;
  const cheapest = useMemo(() => {
    const prices = items.map(i => Number(i.basePrice)).filter(p => Number.isFinite(p) && p > 0);
    return prices.length ? Math.min(...prices) : 0;
  }, [items]);
  const discount = (canRedeem && redeemOn) ? cheapest : 0;
  const taxable = Math.max(0, round2(subtotal - discount));
  const tax = round2(taxable * TAX_RATE);
  const total = round2(taxable + tax);
  const isFree = total <= 0;

  // Mount the card once we have both an order to pay and a signed-in payer.
  useEffect(() => {
    let cancelled = false;
    let localCard = null;
    if (!order || payUnavailable || cardMounted.current) return;
    (async () => {
      try {
        const { card } = await initSquarePayments('si-scan-card');
        if (cancelled) { try { await card.destroy(); } catch { /* noop */ } return; }
        cardMounted.current = true;
        localCard = card;
        setCardObj(card);
        setCardReady(true);
      } catch (err) {
        console.error('Square init failed:', err);
        if (!cancelled) setPayUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
      if (localCard) { cardMounted.current = false; try { localCard.destroy(); } catch { /* noop */ } }
    };
  }, [order, payUnavailable]);

  const pay = async () => {
    if (!isFree && !cardObj) { setError('Payment form is still loading. One moment...'); return; }
    setSubmitting(true); setError('');
    try {
      const token = isFree ? null : await tokenize(cardObj);
      const result = await chargePayment({
        sourceId: token,
        orderId,
        redeem: (canRedeem && redeemOn),
        items: items.map(i => ({ drinkId: i.drinkId, size: i.size, qty: i.qty, addOns: i.addOns || [] })),
        buyerEmail: user?.email,
        note: `Iced Intentions — in-store ${orderId}`,
      });
      setReceipt({
        total: result.amountCharged ?? total,
        tax: result.tax ?? tax,
        discount: result.discountApplied || 0,
        receiptUrl: result.receiptUrl,
        redeemed: Boolean(result.redeemed),
      });
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <PayShell><div style={{ textAlign: 'center', padding: '60px' }}><Loader2 size={26} className="spin" color="#5C3A21" /></div></PayShell>;
  }

  // Covers a mistyped link, an expired charge, and one that's already paid.
  if (!order) {
    return (
      <PayShell>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Coffee size={30} color="#5C3A21" />
          <h1 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '26px', color: '#2A1810', margin: '16px 0 8px 0', fontWeight: 500 }}>
            This charge isn't available
          </h1>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '16px', color: '#5C3A21', margin: '0 0 24px 0' }}>
            It may have already been paid, or the link may be out of date. Ask us to scan you a fresh one.
          </p>
          <button onClick={onDone} style={{ background: '#2A1810', color: '#FAF1E4', padding: '13px 28px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
            Go to the menu
          </button>
        </div>
      </PayShell>
    );
  }

  if (receipt) {
    return (
      <PayShell>
        <div style={{ textAlign: 'center', padding: '30px 0' }}>
          <div style={{ display: 'inline-flex', width: '74px', height: '74px', borderRadius: '50%', background: '#E8A4B8', alignItems: 'center', justifyContent: 'center', marginBottom: '18px' }}>
            <Check size={34} color="#FFFEFA" />
          </div>
          <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '52px', color: '#2A1810', margin: '0 0 6px 0', fontWeight: 400, lineHeight: 1 }}>paid</h1>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '18px', color: '#5C3A21', margin: '0 0 6px 0' }}>
            ${Number(receipt.total).toFixed(2)} — thank you!
          </p>
          <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#3D7A4F', fontWeight: 600, margin: '0 0 26px 0' }}>
            {receipt.redeemed ? '🎁 Reward redeemed' : '☕ Stamp added to your card'}
          </p>
          {receipt.receiptUrl && (
            <p style={{ marginBottom: '20px' }}>
              <a href={receipt.receiptUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5C3A21' }}>
                View receipt
              </a>
            </p>
          )}
          <button onClick={onDone} style={{ background: '#2A1810', color: '#FAF1E4', padding: '13px 28px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
            View my card
          </button>
        </div>
      </PayShell>
    );
  }

  return (
    <PayShell>
      <div style={{ textAlign: 'center', marginBottom: '22px' }}>
        <InfinityHeart size={34} color="#2A1810" />
        <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '44px', color: '#2A1810', margin: '4px 0 0 0', fontWeight: 400, lineHeight: 1 }}>
          your order
        </h1>
      </div>

      <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.12)', borderRadius: '12px', padding: '18px 20px', marginBottom: '16px' }}>
        {items.map((i, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '8px' }}>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810', fontStyle: 'italic' }}>
              {i.qty}× {i.name}
              <span style={{ fontSize: '12px', opacity: 0.65 }}> ({i.sizeDisplay || i.size})</span>
            </span>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', fontWeight: 600, color: '#2A1810', flexShrink: 0 }}>
              ${Number(i.lineTotal || 0).toFixed(2)}
            </span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid rgba(92,58,33,0.15)', marginTop: '10px', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {discount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#A83A56' }}>Free drink reward</span>
              <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#A83A56', fontWeight: 600 }}>−${discount.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21' }}>Sales tax</span>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#2A1810' }}>${tax.toFixed(2)}</span>
          </div>
        </div>
        <div style={{ borderTop: '1px solid rgba(92,58,33,0.2)', marginTop: '10px', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Total</span>
          <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '28px', color: '#2A1810', fontWeight: 600 }}>${total.toFixed(2)}</span>
        </div>
      </div>

      {/* Signing in is what earns the stamp — but it must never gate the
          payment itself. Someone who can't be bothered still gets a drink;
          they just forgo the stamp. */}
      {!user && (
        <div style={{ background: 'linear-gradient(135deg, #2A1810, #5C3A21)', borderRadius: '14px', padding: '18px 20px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Gift size={22} color="#E8A4B8" style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '17px', fontStyle: 'italic', fontWeight: 600, color: '#FAF1E4' }}>
              Sign in to collect your stamp
            </div>
            <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11.5px', color: 'rgba(250,241,228,0.8)', marginTop: '1px' }}>
              One code by email. Your 11th drink is on us.
            </div>
          </div>
          <button onClick={onSignIn}
            style={{ flexShrink: 0, background: '#E8A4B8', color: '#2A1810', border: 'none', borderRadius: '999px', padding: '11px 18px', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer' }}>
            Sign in
          </button>
        </div>
      )}

      {payUnavailable ? (

        <div style={{ background: 'rgba(232,85,122,0.08)', border: '1px solid rgba(232,85,122,0.3)', borderRadius: '8px', padding: '16px' }}>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#2A1810', margin: 0 }}>
            Card payments aren't available right now — please pay at the counter. Sorry about that. 🤍
          </p>
        </div>
      ) : (
        <>
          {canRedeem && (
            <button onClick={() => setRedeemOn(!redeemOn)} data-compact
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: redeemOn ? '#2A1810' : '#FFFEFA', color: redeemOn ? '#FAF1E4' : '#2A1810', border: `1.5px solid ${redeemOn ? '#2A1810' : '#E8A4B8'}`, borderRadius: '12px', padding: '14px 16px', marginBottom: '14px', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Gift size={18} />
                <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', fontStyle: 'italic', fontWeight: 600 }}>
                  {redeemOn ? `Reward applied (−$${cheapest.toFixed(2)})` : `Use a free drink — ${loyaltyBalance} stamps`}
                </span>
              </span>
              <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, flexShrink: 0 }}>
                {redeemOn ? 'Remove' : 'Redeem'}
              </span>
            </button>
          )}

          <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.12)', borderRadius: '12px', padding: '18px', marginBottom: '14px', display: isFree ? 'none' : 'block' }}>
            <div id="si-scan-card" style={{ minHeight: '52px' }} />
            {!cardReady && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#5C3A21', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '14px' }}>
                <Loader2 size={14} className="spin" /> Loading secure card form...
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '8px', color: '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '11px' }}>
              <Lock size={11} /> Secured by Square
            </div>
          </div>

          {error && (
            <div style={{ background: 'rgba(232,85,122,0.1)', border: '1px solid rgba(232,85,122,0.3)', padding: '13px', borderRadius: '6px', marginBottom: '14px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#A83A56' }}>
              {error}
            </div>
          )}

          <button onClick={pay} disabled={submitting || (!isFree && !cardReady)}
            style={{ width: '100%', background: '#2A1810', color: '#FAF1E4', padding: '17px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: (submitting || (!isFree && !cardReady)) ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', opacity: (!isFree && !cardReady) ? 0.6 : 1 }}>
            {submitting
              ? <><Loader2 size={16} className="spin" /> Processing...</>
              : isFree
                ? <><Gift size={15} /> Redeem — $0.00</>
                : <><Lock size={14} /> Pay ${total.toFixed(2)}</>}
          </button>
        </>
      )}
    </PayShell>
  );
};

// ═══════════════════════════════════════════════════════
// ORDER PAGE
// ═══════════════════════════════════════════════════════
const CartDrawer = ({ cart, cartTotal, onClose, onRemove, onCheckout, onBrowse }) => {
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '22px 24px 16px 24px', borderBottom: '1px solid rgba(92,58,33,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShoppingBag size={18} color="#2A1810" />
            <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: 0, fontWeight: 500 }}>
              Your Cart {cartCount > 0 && <span style={{ fontSize: '15px', color: '#5C3A21' }}>({cartCount})</span>}
            </h3>
          </div>
          <button onClick={onClose} data-compact style={{ background: 'rgba(92,58,33,0.07)', border: 'none', borderRadius: '50%', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} aria-label="Close cart">
            <X size={19} color="#2A1810" />
          </button>
        </div>

        {cart.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#F0E2C9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              <ShoppingBag size={26} color="#5C3A21" />
            </div>
            <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', color: '#5C3A21', fontSize: '17px', margin: '0 0 18px 0' }}>
              Your cart is waiting for love letters.
            </p>
            <button onClick={onBrowse} style={{ background: '#2A1810', color: '#FAF1E4', padding: '13px 28px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer' }}>
              Browse the menu
            </button>
          </div>
        ) : (
          <>
            {/* Items */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {cart.map(item => (
                  <div key={item.id} style={{ display: 'flex', gap: '14px', position: 'relative' }}>
                    <div style={{ flexShrink: 0 }}>
                      <DrinkVisual gradient={item.gradient} photo={item.photo} size="xs" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, paddingRight: '20px' }}>
                      <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', color: '#2A1810', fontStyle: 'italic', fontWeight: 500, lineHeight: 1.15 }}>
                        {item.name}
                      </div>
                      <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', color: '#5C3A21', marginTop: '4px', letterSpacing: '0.04em' }}>
                        {sizeLabel(item.drinkId, item.size)} · Qty {item.qty}
                        {item.addOns.length > 0 && ` · +${item.addOns.length} add-on${item.addOns.length > 1 ? 's' : ''}`}
                      </div>
                      {item.notes && (
                        <div style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', color: '#5C3A21', marginTop: '3px' }}>
                          "{item.notes}"
                        </div>
                      )}
                      <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810', marginTop: '5px', fontWeight: 600 }}>
                        ${item.lineTotal.toFixed(2)}
                      </div>
                    </div>
                    <button onClick={() => onRemove(item.id)} data-compact style={{ position: 'absolute', top: 0, right: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#5C3A21', padding: '4px' }} aria-label={`Remove ${item.name}`}>
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div style={{ flexShrink: 0, borderTop: '1px solid rgba(92,58,33,0.12)', padding: '18px 24px 24px 24px', background: '#F0E2C9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Subtotal</span>
                <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '30px', color: '#2A1810', fontWeight: 600 }}>${cartTotal.toFixed(2)}</span>
              </div>
              <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', color: '#5C3A21', margin: '0 0 14px 0' }}>
                Sales tax calculated at checkout.
              </p>
              <button onClick={onCheckout}
                style={{ width: '100%', background: '#2A1810', color: '#FAF1E4', padding: '17px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                Checkout <ChevronRight size={16} />
              </button>
              <button onClick={onBrowse} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', marginTop: '10px', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#5C3A21' }}>
                Keep browsing
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const OrderPage = ({ cart, setCart, user, onSignIn, inStore = false, cartOpen, setCartOpen, showCheckout, setShowCheckout, updateQty, highlightDrinkId, onHighlightDone }) => {
  const [activeCategory, setActiveCategory] = useState('matcha');
  const [selectedDrink, setSelectedDrink] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [store, setStore] = useState({ ordering_paused: false, pause_message: '', sold_out_drinks: [] });

  // Load store settings (pause + sold-out) and keep them live.
  useEffect(() => {
    let alive = true;
    getStoreSettings().then(s => { if (alive) setStore(s); });
    const unsub = subscribeToStoreSettings((s) => setStore(s));
    return () => { alive = false; unsub(); };
  }, []);

  const paused = store.ordering_paused;
  const soldOut = store.sold_out_drinks || [];

  const cartTotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);

  const addToCart = (drink, size, addOns, qty, notes) => {
    const basePrice = size === 'L' ? drink.priceL : drink.priceBucket;
    const addOnTotal = addOns.reduce((s, id) => s + (ADD_ONS.find(a => a.id === id)?.price || 0), 0);
    const lineTotal = (basePrice + addOnTotal) * qty;
    setCart([...cart, {
      id: `${drink.id}-${Date.now()}`, drinkId: drink.id, name: drink.name,
      gradient: drink.gradient, photo: drink.photo || null, size,
      // Carry the human size label so emails and receipts say "32 oz" for
      // single-size refreshers instead of mislabelling them "Bucket".
      sizeDisplay: sizeLabel(drink.id, size),
      addOns, qty, notes, basePrice, lineTotal,
    }]);
    setSelectedDrink(null);
    setCartOpen(true); // slide the cart open so they see the drink was added
  };


  // Jump straight to a drink — the New Arrival banner names one, and
  // dropping people on whatever category happened to be open makes them
  // hunt for the thing they just clicked.
  const cardRefs = useRef({});
  useEffect(() => {
    if (!highlightDrinkId) return;
    const entry = Object.entries(MENU).find(([, c]) => c.items.some(d => d.id === highlightDrinkId));
    if (entry) setActiveCategory(entry[0]);
    // One frame for the category swap to render before we look for the card.
    const t = setTimeout(() => {
      const el = cardRefs.current[highlightDrinkId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('drink-card-spotlight');
        setTimeout(() => el.classList.remove('drink-card-spotlight'), 2800);
      }
      onHighlightDone?.();
    }, 140);
    return () => clearTimeout(t);
  }, [highlightDrinkId]); // eslint-disable-line

  if (confirmation) {
    return <OrderConfirmation order={confirmation} onClose={() => { setConfirmation(null); setCart([]); }} />;
  }
  if (showCheckout) {
    return <CheckoutFlow cart={cart} cartTotal={cartTotal} user={user} paused={paused} inStore={inStore} onUpdateQty={updateQty} onBack={() => setShowCheckout(false)} onComplete={(order) => { setConfirmation(order); setShowCheckout(false); }} />;
  }

  return (
    <div style={{ background: '#FAF1E4', minHeight: '100vh', overflowX: 'hidden', maxWidth: '100%', paddingBottom: cart.length > 0 ? '96px' : '40px' }}>
      <div style={{ maxWidth: '1160px', margin: '0 auto', padding: '36px 20px 20px 20px', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>Order Online</span>
          <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(44px, 11vw, 104px)', color: '#2A1810', margin: '2px 0 0 0', fontWeight: 400, lineHeight: 1 }}>
            Build your sip
          </h1>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: 'clamp(15px, 3.5vw, 19px)', color: '#5C3A21', margin: '10px 0 0 0' }}>
            Choose your drink, make it yours, pick your pickup time.
          </p>
        </div>

        {/* In-store banner — makes it obvious this isn't ordinary browsing. */}
        {inStore && (
          <div style={{ maxWidth: '720px', margin: '0 auto 22px auto', background: '#2A1810', color: '#FAF1E4', borderRadius: '14px', padding: '15px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Coffee size={19} style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', fontStyle: 'italic', fontWeight: 600 }}>
                Ordering at the counter
              </div>
              <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11.5px', opacity: 0.8, marginTop: '1px' }}>
                {user
                  ? 'No pickup time needed — pay here and your stamp is added automatically.'
                  : 'No pickup time needed. Sign in before paying if you want the stamp.'}
              </div>
            </div>
          </div>
        )}

        {/* Paused banner */}
        {paused && (
          <div style={{ maxWidth: '720px', margin: '0 auto 26px auto', background: '#FFFEFA', border: '1.5px solid #E8A4B8', borderRadius: '14px', padding: '18px 22px', textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#A83A56', fontWeight: 600, marginBottom: '6px' }}>
              <PauseCircle size={14} /> Online ordering paused
            </div>
            <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '18px', color: '#2A1810', margin: 0, lineHeight: 1.4 }}>
              {store.pause_message || "We're taking a quick break — online ordering will be back shortly. 🤍"}
            </p>
          </div>
        )}

        {/* Category tabs — centered on desktop, scrollable on mobile */}
        <div className="cat-tabs" style={{ marginBottom: '30px' }}>
          {Object.entries(MENU).map(([key, cat]) => (
            <button key={key} onClick={() => setActiveCategory(key)}
              style={{ padding: '11px 22px', borderRadius: '999px', border: `1.5px solid ${activeCategory === key ? '#2A1810' : 'rgba(92,58,33,0.25)'}`, background: activeCategory === key ? '#2A1810' : 'transparent', color: activeCategory === key ? '#FAF1E4' : '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.25s', flexShrink: 0 }}>
              {cat.title}
            </button>
          ))}
        </div>

        {/* Menu grid — centered, full width */}
        <div className="menu-wrap">
          <div className="menu-grid">
            {MENU[activeCategory].items.map(drink => {
              const isSoldOut = soldOut.includes(drink.id);
              const disabled = isSoldOut || paused;
              return (
              <button key={drink.id} ref={el => { cardRefs.current[drink.id] = el; }} onClick={(e) => !disabled && setSelectedDrink({ drink, origin: e.currentTarget.getBoundingClientRect() })} className="drink-card"
                style={disabled ? { cursor: 'not-allowed' } : undefined} aria-disabled={disabled}>
                <div className="drink-card-imgwrap">
                  {drink.photo ? (
                    <img src={drink.photo} alt={drink.name} loading="lazy" className="drink-card-img" style={isSoldOut ? { filter: 'grayscale(0.7) brightness(0.92)' } : undefined} />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: drink.gradient, filter: isSoldOut ? 'grayscale(0.7)' : undefined }}>
                      <DrinkVisual gradient={drink.gradient} size="sm" />
                    </div>
                  )}
                  {/* NEW sits top-left, opposite the price badge, and yields
                      to Sold out — a drink can't usefully be both. */}
                  {drink.isNew && !isSoldOut && (
                    <div style={{ position: 'absolute', top: '12px', left: '12px', background: '#E8A4B8', color: '#2A1810', borderRadius: '999px', padding: '5px 13px', fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, boxShadow: '0 2px 8px rgba(42,24,16,0.18)' }}>
                      New
                    </div>
                  )}
                  {isSoldOut ? (
                    <div style={{ position: 'absolute', top: '12px', left: '12px', background: '#A83A56', color: '#FFFEFA', borderRadius: '999px', padding: '5px 13px', fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, boxShadow: '0 2px 8px rgba(42,24,16,0.18)' }}>
                      Sold out
                    </div>
                  ) : (
                    <div style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(255, 254, 250, 0.94)', backdropFilter: 'blur(6px)', borderRadius: '999px', padding: '5px 13px', fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', fontWeight: 600, color: '#2A1810', boxShadow: '0 2px 8px rgba(42,24,16,0.14)' }}>
                      ${drink.priceL.toFixed(2)}
                    </div>
                  )}
                </div>
                <div style={{ padding: '16px 16px 18px 16px', minWidth: 0, display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '21px', color: '#2A1810', margin: '0 0 5px 0', fontWeight: 500, fontStyle: 'italic', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{drink.name}</h3>
                  <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11.5px', color: '#5C3A21', lineHeight: 1.5, margin: '0 0 14px 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'break-word', height: '34px' }}>{drink.desc}</p>
                  <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '13px', color: '#5C3A21', fontWeight: 500 }}>
                      {drink.singleSize
                        ? <>32 oz</>
                        : drink.priceBucket !== drink.priceL
                          ? <>Bucket <span style={{ color: '#2A1810', fontWeight: 600 }}>${drink.priceBucket.toFixed(2)}</span></>
                          : <>One size</>}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: disabled ? 'rgba(92,58,33,0.25)' : '#2A1810', color: '#FAF1E4', borderRadius: '999px', padding: '7px 14px', fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500, flexShrink: 0 }}>
                      {isSoldOut ? 'Sold out' : 'Customize'}
                    </span>
                  </div>
                </div>
              </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Drink detail drawer */}
      {selectedDrink && (
        <DrinkCustomizer drink={selectedDrink.drink} origin={selectedDrink.origin} onClose={() => setSelectedDrink(null)} onAdd={addToCart} user={user} onSignIn={onSignIn} />
      )}
    </div>
  );
};
// ═══════════════════════════════════════════════════════
// AUTH MODAL (magic link sign in / join)
// ═══════════════════════════════════════════════════════
const AuthModal = ({ onClose, initialMode = 'login' }) => {
  const [mode, setMode] = useState(initialMode); // 'login' | 'join'
  const [step, setStep] = useState('email');     // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState('');
  const codeRef = useRef(null);

  // Countdown for the "resend code" link.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Autofocus the code box when we get there.
  useEffect(() => {
    if (step === 'code') setTimeout(() => codeRef.current?.focus(), 60);
  }, [step]);

  const sendCode = async () => {
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email.');
      return;
    }
    setSending(true);
    try {
      await sendLoginCode(email, mode === 'join' ? name : '');
      setStep('code');
      setCode('');
      setResendIn(30);
    } catch (err) {
      setError(err.message || 'Could not send your code. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    setError('');
    const clean = code.replace(/\D/g, '');
    if (clean.length < 6) {
      setError('Please enter the full code from your email.');
      return;
    }
    setVerifying(true);
    try {
      await verifyLoginCode(email, clean);
      // onAuthChange (app-level) will pick up the new session and log them in.
      onClose();
    } catch (err) {
      setError(err.message || 'Could not verify your code.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content slide-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(255,254,250,0.95)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }} aria-label="Close">
          <X size={20} color="#2A1810" />
        </button>

        <div style={{ padding: '36px 26px 30px 26px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
            <InfinityHeart size={36} color="#2A1810" />
          </div>

          {step === 'code' ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#F0E2C9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Mail size={26} color="#2A1810" />
                </div>
              </div>
              <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '28px', color: '#2A1810', margin: '0 0 8px 0', fontWeight: 500 }}>Enter your code</h2>
              <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '14px', color: '#5C3A21', lineHeight: 1.6, margin: '0 0 20px 0' }}>
                We emailed a code to <strong>{email}</strong>. Enter it below and you're in.
              </p>

              <input
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                onKeyDown={(e) => e.key === 'Enter' && verify()}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter code"
                style={{ width: '100%', padding: '14px', borderRadius: '8px', border: '1.5px solid rgba(92,58,33,0.25)', background: '#FAF1E4', fontFamily: '"Outfit", sans-serif', fontSize: '28px', letterSpacing: '0.28em', textAlign: 'center', color: '#2A1810', outline: 'none', boxSizing: 'border-box', fontWeight: 600 }}
              />

              {error && (
                <div style={{ background: 'rgba(232,85,122,0.1)', border: '1px solid rgba(232,85,122,0.3)', padding: '10px 12px', borderRadius: '4px', margin: '14px 0 0 0', fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#A83A56', textAlign: 'left' }}>
                  {error}
                </div>
              )}

              <button onClick={verify} disabled={verifying || code.length < 6}
                style={{ width: '100%', background: (verifying || code.length < 6) ? '#5C3A21' : '#2A1810', color: '#FAF1E4', padding: '15px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: (verifying || code.length < 6) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '18px', opacity: (code.length < 6 && !verifying) ? 0.6 : 1 }}>
                {verifying
                  ? <><Loader2 size={15} className="spin" /> Signing you in...</>
                  : <>Verify &amp; sign in <ChevronRight size={14} /></>}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '16px' }}>
                <button onClick={() => { setStep('email'); setError(''); setCode(''); }} data-compact
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '14px', color: '#5C3A21', textDecoration: 'underline' }}>
                  Change email
                </button>
                <span style={{ color: 'rgba(92,58,33,0.3)' }}>·</span>
                <button onClick={sendCode} disabled={resendIn > 0 || sending} data-compact
                  style={{ background: 'none', border: 'none', cursor: (resendIn > 0 || sending) ? 'default' : 'pointer', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '14px', color: (resendIn > 0 || sending) ? 'rgba(92,58,33,0.5)' : '#5C3A21', textDecoration: (resendIn > 0 || sending) ? 'none' : 'underline' }}>
                  {sending ? 'Sending...' : resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                </button>
              </div>
              <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '12px', color: '#5C3A21', marginTop: '14px', opacity: 0.8 }}>
                Can't find it? Check your spam folder.
              </p>
            </>
          ) : (
            <>
              {/* Log in / Join toggle */}
              <div style={{ display: 'flex', background: '#F0E2C9', borderRadius: '999px', padding: '4px', marginBottom: '22px' }}>
                <button onClick={() => { setMode('login'); setError(''); }} data-compact
                  style={{ flex: 1, padding: '9px', borderRadius: '999px', border: 'none', cursor: 'pointer', background: mode === 'login' ? '#2A1810' : 'transparent', color: mode === 'login' ? '#FAF1E4' : '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500, transition: 'all 0.2s' }}>
                  Log In
                </button>
                <button onClick={() => { setMode('join'); setError(''); }} data-compact
                  style={{ flex: 1, padding: '9px', borderRadius: '999px', border: 'none', cursor: 'pointer', background: mode === 'join' ? '#2A1810' : 'transparent', color: mode === 'join' ? '#FAF1E4' : '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500, transition: 'all 0.2s' }}>
                  Join
                </button>
              </div>

              {mode === 'join' ? (
                <>
                  <h2 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '40px', color: '#2A1810', margin: '0 0 4px 0', fontWeight: 400, lineHeight: 1 }}>Join the club</h2>
                  <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '16px', color: '#5C3A21', margin: '0 0 22px 0' }}>
                    Earn a stamp on every order. Your 11th drink is on us.
                  </p>
                </>
              ) : (
                <>
                  <h2 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '40px', color: '#2A1810', margin: '0 0 4px 0', fontWeight: 400, lineHeight: 1 }}>Welcome back</h2>
                  <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '16px', color: '#5C3A21', margin: '0 0 22px 0' }}>
                    Enter your email and we'll send your sign-in code.
                  </p>
                </>
              )}

              {/* Name only matters when joining */}
              {mode === 'join' && (
                <div style={{ textAlign: 'left', marginBottom: '14px' }}>
                  <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '4px' }}>Name (optional)</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '4px', border: '1.5px solid rgba(92,58,33,0.2)', background: '#FAF1E4', fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810', outline: 'none', height: '44px', boxSizing: 'border-box' }} />
                </div>
              )}
              <div style={{ textAlign: 'left', marginBottom: '18px' }}>
                <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '4px' }}>Email *</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@email.com"
                  onKeyDown={(e) => e.key === 'Enter' && sendCode()}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '4px', border: '1.5px solid rgba(92,58,33,0.2)', background: '#FAF1E4', fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810', outline: 'none', height: '44px', boxSizing: 'border-box' }} />
              </div>

              {error && (
                <div style={{ background: 'rgba(232,85,122,0.1)', border: '1px solid rgba(232,85,122,0.3)', padding: '10px 12px', borderRadius: '4px', marginBottom: '14px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#A83A56', textAlign: 'left' }}>
                  {error}
                </div>
              )}

              <button onClick={sendCode} disabled={sending}
                style={{ width: '100%', background: sending ? '#5C3A21' : '#2A1810', color: '#FAF1E4', padding: '15px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: sending ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                {sending
                  ? <><Loader2 size={15} className="spin" /> Sending...</>
                  : <>Send my code <ChevronRight size={14} /></>}
              </button>
              <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', color: '#5C3A21', opacity: 0.75, marginTop: '14px', lineHeight: 1.5 }}>
                We'll email you a 6-digit code — no password to remember.{mode === 'join' ? ' By joining you agree to receive your loyalty updates.' : ''}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// STAMP CARD (visual loyalty progress)
// ═══════════════════════════════════════════════════════
const StampCard = ({ balance }) => {
  const earned = ((balance % STAMPS_FOR_REWARD) + STAMPS_FOR_REWARD) % STAMPS_FOR_REWARD;
  const rewardsAvailable = Math.floor(balance / STAMPS_FOR_REWARD);
  const filled = rewardsAvailable > 0 && earned === 0 ? STAMPS_FOR_REWARD : earned;

  return (
    <div style={{ background: 'linear-gradient(135deg, #2A1810, #5C3A21)', borderRadius: '12px', padding: '24px', color: '#FAF1E4', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -20, right: -20, opacity: 0.1 }}>
        <Coffee size={120} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', position: 'relative' }}>
        <div>
          <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.25em', textTransform: 'uppercase', opacity: 0.7 }}>Loyalty Card</div>
          <div style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '32px', lineHeight: 1, marginTop: '2px' }}>Iced Intentions</div>
        </div>
        <Gift size={24} style={{ opacity: 0.9 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '18px', position: 'relative' }}>
        {Array.from({ length: STAMPS_FOR_REWARD }).map((_, i) => (
          <div key={i} style={{
            aspectRatio: '1', borderRadius: '50%',
            border: `1.5px solid ${i < filled ? '#E8A4B8' : 'rgba(250,241,228,0.3)'}`,
            background: i < filled ? '#E8A4B8' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.3s',
          }}>
            {i < filled
              ? <Coffee size={16} color="#2A1810" />
              : <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '14px', opacity: 0.4 }}>{i + 1}</span>}
          </div>
        ))}
      </div>

      <div style={{ position: 'relative' }}>
        {rewardsAvailable > 0 ? (
          <div style={{ background: '#E8A4B8', color: '#2A1810', borderRadius: '8px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Gift size={18} />
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', fontWeight: 600 }}>
              {rewardsAvailable === 1 ? 'Free drink ready!' : `${rewardsAvailable} free drinks ready!`} Redeem at checkout.
            </span>
          </div>
        ) : (
          <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', fontStyle: 'italic', opacity: 0.9 }}>
            {STAMPS_FOR_REWARD - filled} more {STAMPS_FOR_REWARD - filled === 1 ? 'stamp' : 'stamps'} until your free drink ☕
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// DASHBOARD PAGE
// ═══════════════════════════════════════════════════════
const DashboardPage = ({ user, setPage, onReorder, isAdmin }) => {
  const [balance, setBalance] = useState(0);
  const [history, setHistory] = useState([]);
  const [orders, setOrders] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    const [b, h, o, f] = await Promise.all([
      getLoyaltyBalance(user.id),
      getLoyaltyHistory(user.id),
      getMyOrders(user.id),
      getFavorites(user.id),
    ]);
    setBalance(b); setHistory(h); setOrders(o); setFavorites(f);
    setLoading(false);
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [user?.id]);

  const handleRemoveFav = async (id) => {
    try {
      await removeFavorite(user.id, id);
      setFavorites(favorites.filter(f => f.id !== id));
    } catch (e) { console.warn(e); }
  };

  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
    catch { return iso; }
  };

  // The customer's own purchase history, summarised.
  const purchaseStats = useMemo(() => {
    const spent = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const saved = orders.reduce((s, o) => s + (Number(o.discount) || 0), 0);
    const byDrink = {};
    orders.forEach(o => (o.items || []).forEach(it => {
      const key = it.name || it.drinkId;
      if (key) byDrink[key] = (byDrink[key] || 0) + (Number(it.qty) || 0);
    }));
    const top = Object.entries(byDrink).sort((a, b) => b[1] - a[1])[0];
    return {
      count: orders.length,
      spent,
      saved,
      avg: orders.length ? spent / orders.length : 0,
      favourite: top ? { name: top[0], qty: top[1] } : null,
    };
  }, [orders]);

  return (
    <div style={{ background: '#FAF1E4', minHeight: '100vh' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px 80px 20px' }}>
        <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px' }}>
          <div>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>Welcome back</span>
            <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(40px, 10vw, 72px)', color: '#2A1810', margin: '4px 0 0 0', fontWeight: 400, lineHeight: 1 }}>
              {displayName(user)}
            </h1>
          </div>
          <button onClick={() => { signOut(); setPage('home'); }} data-compact
            style={{ background: 'none', border: '1.5px solid rgba(92,58,33,0.25)', borderRadius: '999px', padding: '8px 14px', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5C3A21', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginBottom: '6px' }}>
            <LogOut size={13} /> Sign out
          </button>
        </div>

        {isAdmin && (
          <button onClick={() => setPage('owner')}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: '#2A1810', color: '#FAF1E4', border: 'none', borderRadius: '14px', padding: '16px 20px', cursor: 'pointer', marginBottom: '24px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
              <LayoutDashboard size={19} />
              <span style={{ textAlign: 'left' }}>
                <span style={{ display: 'block', fontFamily: '"Cormorant Garamond", serif', fontSize: '19px', fontStyle: 'italic', fontWeight: 600 }}>Owner Dashboard</span>
                <span style={{ display: 'block', fontFamily: '"Outfit", sans-serif', fontSize: '11px', opacity: 0.8 }}>Orders, sold-out & pause controls</span>
              </span>
            </span>
            <ChevronRight size={18} />
          </button>
        )}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#5C3A21', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '16px', padding: '40px 0' }}>
            <Loader2 size={18} className="spin" /> Loading your card...
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '28px' }}>
              <StampCard balance={balance} />
            </div>

            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <button onClick={() => setPage('order')}
                style={{ background: '#2A1810', color: '#FAF1E4', padding: '14px 32px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                Order a drink <ChevronRight size={14} />
              </button>
            </div>

            {/* FAVORITES */}
            <section style={{ marginBottom: '32px' }}>
              <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: '0 0 14px 0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Heart size={18} fill="#E8A4B8" stroke="#E8A4B8" /> My Favorites
              </h2>
              {favorites.length === 0 ? (
                <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#5C3A21', background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '8px', padding: '20px', margin: 0, textAlign: 'center' }}>
                  No saved favorites yet. Tap the heart when customizing a drink to save your usual.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {favorites.map(fav => (
                    <div key={fav.id} style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '8px', padding: '14px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{ flexShrink: 0 }}>
                        <DrinkVisual gradient={fav.drink.gradient} photo={fav.drink.photo} size="xs" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', fontStyle: 'italic', fontWeight: 500, color: '#2A1810' }}>{fav.label || fav.drink.name}</div>
                        <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', color: '#5C3A21', marginTop: '2px' }}>
                          {fav.drink.name} · {sizeLabel(fav.drink.id, fav.drink.size)}
                          {fav.drink.addOns?.length > 0 && ` · +${fav.drink.addOns.length} add-on${fav.drink.addOns.length > 1 ? 's' : ''}`}
                          {fav.drink.notes && ` · "${fav.drink.notes}"`}
                        </div>
                      </div>
                      <button onClick={() => onReorder(fav.drink)} data-compact title="Add to cart"
                        style={{ background: '#2A1810', color: '#FAF1E4', border: 'none', borderRadius: '999px', padding: '8px 14px', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <RotateCcw size={12} /> Order
                      </button>
                      <button onClick={() => handleRemoveFav(fav.id)} data-compact title="Remove favorite"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5C3A21', padding: '6px', flexShrink: 0 }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* RECENT ORDERS */}
            <section style={{ marginBottom: '32px' }}>
              <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: '0 0 14px 0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingBag size={18} /> Recent Orders
              </h2>

              {/* Their own purchase history at a glance. */}
              {orders.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', gap: '9px', marginBottom: '12px' }}>
                  {[
                    { label: 'Orders', value: purchaseStats.count },
                    { label: 'Total spent', value: `$${purchaseStats.spent.toFixed(2)}` },
                    { label: 'Avg order', value: `$${purchaseStats.avg.toFixed(2)}` },
                    { label: 'Saved in rewards', value: `$${purchaseStats.saved.toFixed(2)}` },
                  ].map(s => (
                    <div key={s.label} style={{ background: '#F0E2C9', borderRadius: '10px', padding: '12px 10px', textAlign: 'center' }}>
                      <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '21px', color: '#2A1810', fontWeight: 600, lineHeight: 1 }}>{s.value}</div>
                      <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#5C3A21', marginTop: '4px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
              {purchaseStats.favourite && (
                <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#5C3A21', margin: '0 0 12px 0' }}>
                  Your usual is the <strong style={{ color: '#2A1810', fontWeight: 600 }}>{purchaseStats.favourite.name}</strong> — ordered {purchaseStats.favourite.qty}×.
                </p>
              )}
              {orders.length === 0 ? (
                <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#5C3A21', background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '8px', padding: '20px', margin: 0, textAlign: 'center' }}>
                  No orders yet. Your order history will appear here.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {orders.map(o => (
                    <div key={o.id} style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '8px', padding: '14px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
                        <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810', fontWeight: 500 }}>
                          {(o.items || []).map(it => `${it.qty}× ${it.name}`).join(', ')}
                        </div>
                        <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810', fontWeight: 600, flexShrink: 0 }}>${Number(o.total).toFixed(2)}</div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                        <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', color: '#5C3A21' }}>
                          {fmtDate(o.created_at)} · pickup {o.pickup_time_display}
                        </span>
                        <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, color: o.payment_status === 'paid' ? '#3D7A4F' : '#5C3A21', background: o.payment_status === 'paid' ? 'rgba(61,122,79,0.1)' : 'rgba(92,58,33,0.08)', padding: '3px 8px', borderRadius: '999px' }}>
                          {o.payment_status === 'paid' ? 'Paid' : 'Payment pending'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* STAMP HISTORY */}
            <section>
              <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: '0 0 14px 0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Star size={18} /> Stamp Activity
              </h2>
              {history.length === 0 ? (
                <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#5C3A21', background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '8px', padding: '20px', margin: 0, textAlign: 'center' }}>
                  Your stamps will show up here as you order.
                </p>
              ) : (
                <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '8px', overflow: 'hidden' }}>
                  {history.map((h, idx) => (
                    <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: idx < history.length - 1 ? '1px solid rgba(92,58,33,0.08)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: h.reason === 'redeemed' ? 'rgba(232,164,184,0.25)' : '#F0E2C9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {h.reason === 'redeemed' ? <Gift size={14} color="#A83A56" /> : <Coffee size={14} color="#2A1810" />}
                        </div>
                        <div>
                          <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#2A1810', fontWeight: 500 }}>
                            {h.reason === 'redeemed' ? 'Free drink redeemed' : 'Stamp earned'}
                          </div>
                          <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', color: '#5C3A21' }}>{fmtDate(h.created_at)}</div>
                        </div>
                      </div>
                      <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', fontWeight: 600, color: h.delta > 0 ? '#3D7A4F' : '#A83A56' }}>
                        {h.delta > 0 ? `+${h.delta}` : h.delta}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// CHARGE IN PERSON (owner only)
// ───────────────────────────────────────────────────────────────
// The customer has already ordered at the counter. Rather than making
// them rebuild the whole thing on their phone, the barista taps it in
// here, hits Create, and shows them the QR. They scan, sign in, pay, and
// the stamp lands on their card.
// ═══════════════════════════════════════════════════════════════
const InPersonCharge = () => {
  const [lines, setLines] = useState([]);
  const [charge, setCharge] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const allDrinks = useMemo(
    () => Object.values(MENU).flatMap(c => c.items),
    [],
  );

  const addLine = (drink, size) => {
    const basePrice = size === 'L' ? drink.priceL : drink.priceBucket;
    setLines(ls => [...ls, {
      key: `${drink.id}-${size}-${ls.length}-${Date.now()}`,
      drinkId: drink.id, name: drink.name, size,
      sizeDisplay: sizeLabel(drink.id, size),
      addOns: [], qty: 1, basePrice,
    }]);
    setCharge(null);
  };

  const patchLine = (key, patch) => {
    setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l));
    setCharge(null);
  };
  const removeLine = (key) => { setLines(ls => ls.filter(l => l.key !== key)); setCharge(null); };

  const lineTotal = (l) => {
    const addOnSum = l.addOns.reduce((s, id) => s + (ADD_ONS.find(a => a.id === id)?.price || 0), 0);
    return round2((l.basePrice + addOnSum) * l.qty);
  };
  const subtotal = round2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const tax = round2(subtotal * TAX_RATE);
  const total = round2(subtotal + tax);

  const createCharge = async () => {
    if (lines.length === 0) return;
    setCreating(true); setError('');
    try {
      // A random id, not a sequential one: it goes in a URL the customer
      // scans, and a guessable id would let a stranger pay someone's tab.
      const id = `ins_${(crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/-/g, '')}`;
      const items = lines.map(l => ({
        drinkId: l.drinkId, name: l.name, size: l.size, sizeDisplay: l.sizeDisplay,
        addOns: l.addOns, qty: l.qty, basePrice: l.basePrice, lineTotal: lineTotal(l),
      }));
      await saveOrder(id, {
        id,
        orderType: 'instore',
        userId: null, // claimed by whoever pays it
        pickupDate: formatLocalDate(new Date()),
        pickupTime: null,
        pickupTimeDisplay: 'In-store',
        customer: { name: 'In-store', phone: '', email: '' },
        items,
        subtotal, discount: 0, tax, total,
        paymentStatus: 'pending',
      });
      setCharge({ id, url: `${window.location.origin}/?pay=${id}`, total });
    } catch (err) {
      console.error(err);
      setError(err.message || 'Could not create the charge. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const reset = () => { setLines([]); setCharge(null); setError(''); };

  if (charge) {
    return (
      <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '16px', padding: '22px', marginBottom: '24px', textAlign: 'center' }}>
        <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: '0 0 4px 0', fontWeight: 500 }}>
          Have them scan this
        </h2>
        <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '16px', color: '#5C3A21', margin: '0 0 18px 0' }}>
          ${charge.total.toFixed(2)} — they'll sign in, pay, and get their stamp.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <QrCode value={charge.url} size={230} />
        </div>
        <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', color: '#5C3A21', wordBreak: 'break-all', margin: '0 0 18px 0' }}>
          {charge.url}
        </p>
        <button onClick={reset}
          style={{ background: '#2A1810', color: '#FAF1E4', padding: '13px 28px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer' }}>
          New charge
        </button>
        <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', color: '#5C3A21', margin: '14px 0 0 0' }}>
          It'll appear on today's board as paid the moment they finish.
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '16px', padding: '22px', marginBottom: '24px' }}>
      <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: '0 0 4px 0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '9px' }}>
        <QrCodeIcon size={18} /> Charge in person
      </h2>
      <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', margin: '0 0 16px 0' }}>
        Tap what they ordered, then show them the QR so they can pay on their phone and earn a stamp.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: '7px', marginBottom: '18px' }}>
        {allDrinks.map(d => (
          <div key={d.id} style={{ border: '1.5px solid rgba(92,58,33,0.15)', borderRadius: '10px', padding: '9px 11px', background: '#FAF1E4' }}>
            <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', fontStyle: 'italic', fontWeight: 600, color: '#2A1810', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '6px' }}>
              {d.name}
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
              {(d.singleSize ? [['BUCKET', '32 oz', d.priceBucket]] : [['L', 'L', d.priceL], ['BUCKET', 'Bkt', d.priceBucket]]).map(([sz, lbl, pr]) => (
                <button key={sz} onClick={() => addLine(d, sz)} data-compact
                  style={{ flex: 1, padding: '6px 4px', borderRadius: '6px', border: 'none', background: '#2A1810', color: '#FAF1E4', fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.06em', fontWeight: 600, cursor: 'pointer' }}>
                  {lbl} ${pr.toFixed(2)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {lines.length === 0 ? (
        <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#5C3A21', textAlign: 'center', padding: '14px', margin: 0 }}>
          Nothing added yet.
        </p>
      ) : (
        <div style={{ borderTop: '1px solid rgba(92,58,33,0.12)', paddingTop: '14px' }}>
          {lines.map(l => (
            <div key={l.key} style={{ borderBottom: '1px solid rgba(92,58,33,0.08)', paddingBottom: '10px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', fontStyle: 'italic', fontWeight: 600, color: '#2A1810', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.name} <span style={{ fontSize: '12px', opacity: 0.7 }}>({l.sizeDisplay})</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <button onClick={() => patchLine(l.key, { qty: Math.max(1, l.qty - 1) })} data-compact style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid rgba(92,58,33,0.25)', background: '#FFFEFA', cursor: 'pointer' }}>−</button>
                  <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '17px', fontWeight: 600, minWidth: '20px', textAlign: 'center' }}>{l.qty}</span>
                  <button onClick={() => patchLine(l.key, { qty: l.qty + 1 })} data-compact style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid rgba(92,58,33,0.25)', background: '#FFFEFA', cursor: 'pointer' }}>+</button>
                  <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', fontWeight: 600, minWidth: '54px', textAlign: 'right' }}>${lineTotal(l).toFixed(2)}</span>
                  <button onClick={() => removeLine(l.key)} data-compact style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A83A56', padding: '2px' }} aria-label="Remove"><X size={15} /></button>
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '7px' }}>
                {ADD_ONS.map(a => {
                  const on = l.addOns.includes(a.id);
                  return (
                    <button key={a.id} data-compact
                      onClick={() => patchLine(l.key, { addOns: on ? l.addOns.filter(x => x !== a.id) : [...l.addOns, a.id] })}
                      style={{ padding: '4px 9px', borderRadius: '999px', border: `1px solid ${on ? '#E8A4B8' : 'rgba(92,58,33,0.2)'}`, background: on ? '#E8A4B8' : 'transparent', color: '#2A1810', fontFamily: '"Outfit", sans-serif', fontSize: '10px', cursor: 'pointer' }}>
                      {a.name} +${a.price.toFixed(2)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', marginBottom: '4px' }}>
            <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', marginBottom: '10px' }}>
            <span>Sales tax</span><span>${tax.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#5C3A21' }}>Total</span>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '26px', fontWeight: 600, color: '#2A1810' }}>${total.toFixed(2)}</span>
          </div>

          {error && (
            <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#A83A56', marginBottom: '10px' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={reset} data-compact
              style={{ padding: '13px 18px', borderRadius: '999px', border: '1.5px solid rgba(92,58,33,0.25)', background: 'transparent', color: '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
              Clear
            </button>
            <button onClick={createCharge} disabled={creating}
              style={{ flex: 1, background: '#2A1810', color: '#FAF1E4', padding: '13px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 500, cursor: creating ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px' }}>
              {creating ? <><Loader2 size={15} className="spin" /> Creating...</> : <>Create charge <ChevronRight size={14} /></>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// COUNTER QR (owner only) — the printable self-service sign
// ═══════════════════════════════════════════════════════════════
const CounterQr = () => {
  const url = `${window.location.origin}/?instore=1`;
  return (
    <div className="counter-qr" style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '16px', padding: '22px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '6px' }}>
        <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: 0, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '9px' }}>
          <QrCodeIcon size={18} /> Counter QR
        </h2>
        <button onClick={() => window.print()} data-compact className="no-print"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '8px 16px', borderRadius: '999px', border: '1.5px solid rgba(92,58,33,0.25)', background: 'transparent', color: '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
          <Printer size={13} /> Print
        </button>
      </div>
      <p className="no-print" style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', margin: '0 0 18px 0' }}>
        Print this and stand it on the counter. Customers scan it to order and pay on their own phone — no pickup time, and they earn a stamp.
      </p>

      {/* The printed card itself. */}
      <div className="print-card" style={{ border: '1.5px dashed rgba(92,58,33,0.3)', borderRadius: '14px', padding: '26px 20px', textAlign: 'center', maxWidth: '360px', margin: '0 auto' }}>
        <InfinityHeart size={40} color="#2A1810" />
        <h3 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '38px', color: '#2A1810', margin: '4px 0 2px 0', fontWeight: 400, lineHeight: 1 }}>
          earn a stamp
        </h3>
        <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '16px', color: '#5C3A21', margin: '0 0 18px 0' }}>
          Scan, order & pay on your phone.<br />Your 11th drink is on us.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <QrCode value={url} size={200} />
        </div>
        <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', color: '#5C3A21', margin: '14px 0 0 0' }}>
          {url.replace(/^https?:\/\//, '')}
        </p>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// SALES ANALYTICS (owner only)
// ───────────────────────────────────────────────────────────────
// Everything here is derived from PAID orders only — pending rows are
// abandoned checkouts and would inflate every figure.
// ═══════════════════════════════════════════════════════════════
const RANGES = [
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
];

// RFC-4180 escaping: wrap in quotes, double any internal quote. Without
// this a customer name containing a comma silently shifts every column.
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Module scope for the same reason as PayShell above.
const Money = ({ label, value, accent }) => (
  <div style={{ background: accent ? '#2A1810' : '#F0E2C9', color: accent ? '#FAF1E4' : '#2A1810', borderRadius: '12px', padding: '14px 16px', textAlign: 'center' }}>
    <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(20px, 4.5vw, 28px)', fontWeight: 600, lineHeight: 1 }}>{value}</div>
    <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '9px', letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.75, marginTop: '5px' }}>{label}</div>
  </div>
);

const Bars = ({ title, rows, unit }) => {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return (
    <div>
      <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '19px', color: '#2A1810', margin: '0 0 12px 0', fontWeight: 600, fontStyle: 'italic' }}>{title}</h3>
      {rows.length === 0 ? (
        <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '14px', color: '#5C3A21', margin: 0 }}>No data yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {rows.map(([name, n]) => (
            <div key={name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#3D2817', marginBottom: '3px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '8px' }}>{name}</span>
                <span style={{ fontWeight: 600, flexShrink: 0 }}>{n} {unit}</span>
              </div>
              <div style={{ height: '7px', background: 'rgba(92,58,33,0.1)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: '#E8A4B8', borderRadius: '999px' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


const SalesAnalytics = () => {
  const [days, setDays] = useState(30);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    return { start: formatLocalDate(start), end: formatLocalDate(end) };
  }, [days]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getOrdersInRange(range.start, range.end).then(rows => {
      if (alive) { setOrders(rows); setLoading(false); }
    });
    return () => { alive = false; };
  }, [range.start, range.end]);

  const stats = useMemo(() => {
    const gross = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const tax = orders.reduce((s, o) => s + (Number(o.tax) || 0), 0);
    const discounts = orders.reduce((s, o) => s + (Number(o.discount) || 0), 0);
    // Split by tender: cash is what should physically be in the drawer,
    // card is what Square will actually deposit. Reconciling the two is
    // the whole job at the end of a shift.
    const cash = orders.filter(o => o.payment_method === 'cash')
      .reduce((s, o) => s + (Number(o.total) || 0), 0);
    const card = gross - cash;

    // Units sold per drink, and revenue by pickup slot.
    const byDrink = {};
    const bySlot = {};
    orders.forEach(o => {
      (o.items || []).forEach(it => {
        const key = it.name || it.drinkId || 'Unknown';
        byDrink[key] = (byDrink[key] || 0) + (Number(it.qty) || 0);
      });
      const slot = o.pickup_time_display || o.pickup_time || '—';
      bySlot[slot] = (bySlot[slot] || 0) + 1;
    });

    // A customer is identified by account where we have one, else by email.
    const seen = new Map();
    orders.forEach(o => {
      const key = o.user_id || (o.customer?.email || '').toLowerCase();
      if (!key) return;
      seen.set(key, (seen.get(key) || 0) + 1);
    });
    const repeat = [...seen.values()].filter(n => n > 1).length;

    return {
      gross,
      tax,
      cash,
      card,
      net: gross - tax,
      discounts,
      count: orders.length,
      avg: orders.length ? gross / orders.length : 0,
      topDrinks: Object.entries(byDrink).sort((a, b) => b[1] - a[1]).slice(0, 5),
      topSlots: Object.entries(bySlot).sort((a, b) => b[1] - a[1]).slice(0, 5),
      customers: seen.size,
      repeat,
    };
  }, [orders]);

  const downloadCsv = () => {
    const header = [
      'Order ID', 'Pickup date', 'Pickup time', 'Customer', 'Email', 'Phone',
      'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Tender', 'Channel', 'Square payment ID', 'Placed at',
    ];
    const rows = orders.map(o => [
      o.id, o.pickup_date, o.pickup_time_display || o.pickup_time,
      o.customer?.name, o.customer?.email, o.customer?.phone,
      (o.items || []).map(i => `${i.qty}x ${i.name} (${i.sizeDisplay || i.size})`).join('; '),
      Number(o.subtotal ?? 0).toFixed(2),
      Number(o.discount ?? 0).toFixed(2),
      Number(o.tax ?? 0).toFixed(2),
      Number(o.total ?? 0).toFixed(2),
      o.payment_method || 'card', o.order_type || 'pickup',
      o.square_payment_id, o.created_at,
    ]);
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    // BOM so Excel opens UTF-8 names (Verdí, Blanquí) correctly.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iced-intentions-orders_${range.start}_to_${range.end}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '16px', padding: '22px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: 0, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '9px' }}>
          <TrendingUp size={18} /> Sales analytics
        </h2>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {RANGES.map(r => (
            <button key={r.id} onClick={() => setDays(r.id)} data-compact
              style={{ padding: '7px 14px', borderRadius: '999px', border: `1.5px solid ${days === r.id ? '#2A1810' : 'rgba(92,58,33,0.2)'}`, background: days === r.id ? '#2A1810' : 'transparent', color: days === r.id ? '#FAF1E4' : '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.08em', cursor: 'pointer' }}>
              {r.label}
            </button>
          ))}
          <button onClick={downloadCsv} disabled={orders.length === 0} data-compact
            title={orders.length === 0 ? 'No orders in this range' : 'Download CSV'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '999px', border: '1.5px solid rgba(92,58,33,0.2)', background: 'transparent', color: '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.08em', cursor: orders.length === 0 ? 'not-allowed' : 'pointer', opacity: orders.length === 0 ? 0.5 : 1 }}>
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px' }}><Loader2 size={20} className="spin" color="#5C3A21" /></div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '9px', marginBottom: '20px' }}>
            <Money label="Net sales" value={`$${stats.net.toFixed(2)}`} accent />
            <Money label="Sales tax" value={`$${stats.tax.toFixed(2)}`} />
            <Money label="Total taken" value={`$${stats.gross.toFixed(2)}`} />
            <Money label="Orders" value={stats.count} />
            <Money label="Avg order" value={`$${stats.avg.toFixed(2)}`} />
            <Money label="Cash taken" value={`$${stats.cash.toFixed(2)}`} />
            <Money label="Card taken" value={`$${stats.card.toFixed(2)}`} />
          </div>

          <div className="grid-2-md" style={{ gap: '24px', marginBottom: '18px' }}>
            <Bars title="Best sellers" rows={stats.topDrinks} unit="sold" />
            <Bars title="Busiest pickup times" rows={stats.topSlots} unit="orders" />
          </div>

          <div style={{ borderTop: '1px solid rgba(92,58,33,0.1)', paddingTop: '14px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21' }}>
              <strong style={{ color: '#2A1810' }}>{stats.customers}</strong> customers
            </span>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21' }}>
              <strong style={{ color: '#2A1810' }}>{stats.repeat}</strong> came back
            </span>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21' }}>
              <strong style={{ color: '#2A1810' }}>${stats.discounts.toFixed(2)}</strong> in rewards redeemed
            </span>
          </div>
        </>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// OWNER DASHBOARD (admin only)
// ═══════════════════════════════════════════════════════════════
const OwnerDashboard = ({ user, setPage, role }) => {
  const isOwner = role === 'owner';
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [dateIso, setDateIso] = useState(formatLocalDate(new Date()));
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [settings, setSettings] = useState({ ordering_paused: false, pause_message: '', sold_out_drinks: [] });
  const [pauseMsgDraft, setPauseMsgDraft] = useState('');
  const [savingPause, setSavingPause] = useState(false);
  const [savingDrink, setSavingDrink] = useState(null);
  const days = useMemo(() => getNextSevenDays(), []);

  const allDrinks = useMemo(() => {
    const out = [];
    Object.values(MENU).forEach(cat => cat.items.forEach(d => out.push({ id: d.id, name: d.name, category: cat.title })));
    return out;
  }, []);

  // Verify admin on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await amIAdmin();
      if (!alive) return;
      setIsAdmin(ok);
      setChecking(false);
      if (ok) {
        const s = await getStoreSettings();
        if (!alive) return;
        setSettings(s); setPauseMsgDraft(s.pause_message);
      }
    })();
    return () => { alive = false; };
  }, [user]);

  // Load orders for the chosen date + live refresh.
  const refreshOrders = async (d) => {
    setLoadingOrders(true);
    const rows = await getOrdersForDate(d);
    setOrders(rows);
    setLoadingOrders(false);
  };
  useEffect(() => {
    if (!isAdmin) return;
    refreshOrders(dateIso);
    const unsubO = subscribeToOrders(() => refreshOrders(dateIso));
    const unsubS = subscribeToStoreSettings((s) => { setSettings(s); setPauseMsgDraft(s.pause_message); });
    return () => { unsubO(); unsubS(); };
  }, [isAdmin, dateIso]);

  const togglePause = async () => {
    setSavingPause(true);
    try {
      const next = !settings.ordering_paused;
      const saved = await updateStoreSettings({ ordering_paused: next, pause_message: pauseMsgDraft });
      setSettings(s => ({ ...s, ordering_paused: !!saved.ordering_paused, pause_message: saved.pause_message || '' }));
    } catch (e) { alert('Could not update: ' + (e.message || 'try again')); }
    setSavingPause(false);
  };

  const savePauseMessage = async () => {
    setSavingPause(true);
    try {
      const saved = await updateStoreSettings({ pause_message: pauseMsgDraft });
      setSettings(s => ({ ...s, pause_message: saved.pause_message || '' }));
    } catch (e) { alert('Could not save message: ' + (e.message || 'try again')); }
    setSavingPause(false);
  };

  const toggleSoldOut = async (drinkId) => {
    setSavingDrink(drinkId);
    try {
      const current = settings.sold_out_drinks || [];
      const next = current.includes(drinkId) ? current.filter(x => x !== drinkId) : [...current, drinkId];
      const saved = await updateStoreSettings({ sold_out_drinks: next });
      setSettings(s => ({ ...s, sold_out_drinks: Array.isArray(saved.sold_out_drinks) ? saved.sold_out_drinks : next }));
    } catch (e) { alert('Could not update: ' + (e.message || 'try again')); }
    setSavingDrink(null);
  };

  const toggleFulfilled = async (order) => {
    try {
      await setOrderFulfilled(order.id, !order.fulfilled);
      setOrders(os => os.map(o => o.id === order.id ? { ...o, fulfilled: !o.fulfilled } : o));
    } catch (e) { alert('Could not update order: ' + (e.message || 'try again')); }
  };

  // ── Guards ──
  if (!user) {
    return <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
      <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '20px', color: '#5C3A21' }}>Please sign in to continue.</p>
    </div>;
  }
  if (checking) {
    return <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 size={26} className="spin" color="#5C3A21" />
    </div>;
  }
  if (!isAdmin) {
    return <div style={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
      <Lock size={28} color="#5C3A21" />
      <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '20px', color: '#5C3A21', margin: '14px 0' }}>This area is for the Iced Intentions team.</p>
      <button onClick={() => setPage('home')} style={{ background: '#2A1810', color: '#FAF1E4', padding: '12px 26px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>Back home</button>
    </div>;
  }

  // ── Stats ──
  const paidOrders = orders.filter(o => o.payment_status === 'paid');
  const revenue = paidOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  // Tax collected is money held on the state's behalf, not takings — keep it
  // visible and separate from the net so the day's figures are filing-ready.
  const taxCollected = paidOrders.reduce((s, o) => s + (Number(o.tax) || 0), 0);
  const netSales = revenue - taxCollected;
  const pendingCount = orders.filter(o => !o.fulfilled).length;

  const itemsSummary = (items) => (items || []).map(it => `${it.qty}× ${it.name} (${sizeLabel(it.drinkId, it.size)})`).join(', ');

  return (
    <div style={{ background: '#FAF1E4', minHeight: '100vh', padding: '32px 20px 80px 20px' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <LayoutDashboard size={20} color="#2A1810" />
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>{isOwner ? 'Owner Dashboard' : 'Staff'}</span>
          </div>
          <button onClick={() => refreshOrders(dateIso)} data-compact style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', background: 'transparent', border: '1.5px solid rgba(92,58,33,0.25)', borderRadius: '999px', padding: '8px 16px', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5C3A21', cursor: 'pointer' }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(40px, 9vw, 68px)', color: '#2A1810', margin: '0 0 6px 0', fontWeight: 400, lineHeight: 1 }}>
          Good day, {displayName(user)}
        </h1>

        {/* Store status banner */}
        <div style={{ background: settings.ordering_paused ? '#A83A56' : '#3D7A4F', color: '#FAF1E4', borderRadius: '12px', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '10px', margin: '18px 0 28px 0' }}>
          {settings.ordering_paused ? <PauseCircle size={18} /> : <PlayCircle size={18} />}
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', fontWeight: 500 }}>
            {settings.ordering_paused ? 'Online ordering is PAUSED — customers cannot place orders.' : 'Online ordering is live — accepting orders.'}
          </span>
        </div>

        {isOwner && <>
        {/* ── STORE CONTROLS ── */}
        <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '16px', padding: '22px', marginBottom: '24px' }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: '0 0 18px 0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '9px' }}>
            <Power size={18} /> Store controls
          </h2>

          {/* Pause toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', paddingBottom: '18px', borderBottom: '1px solid rgba(92,58,33,0.1)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '19px', fontStyle: 'italic', color: '#2A1810', fontWeight: 600 }}>Pause online ordering</div>
              <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', marginTop: '2px' }}>Flip this when you're closed, slammed, or out of supplies.</div>
            </div>
            <button onClick={togglePause} disabled={savingPause}
              style={{ flexShrink: 0, position: 'relative', width: '64px', height: '34px', borderRadius: '999px', border: 'none', cursor: savingPause ? 'wait' : 'pointer', background: settings.ordering_paused ? '#A83A56' : '#3D7A4F', transition: 'background 0.25s' }}>
              <span style={{ position: 'absolute', top: '3px', left: settings.ordering_paused ? '33px' : '3px', width: '28px', height: '28px', borderRadius: '50%', background: '#FFFEFA', transition: 'left 0.25s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
            </button>
          </div>

          {/* Pause message */}
          <div style={{ paddingTop: '16px' }}>
            <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '6px' }}>
              Message shown to customers while paused
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input value={pauseMsgDraft} onChange={e => setPauseMsgDraft(e.target.value)} placeholder="We're taking a quick break…"
                style={{ flex: 1, minWidth: '200px', padding: '11px 13px', borderRadius: '8px', border: '1.5px solid rgba(92,58,33,0.2)', background: '#FAF1E4', fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#2A1810', outline: 'none' }} />
              <button onClick={savePauseMessage} disabled={savingPause || pauseMsgDraft === settings.pause_message}
                style={{ background: (pauseMsgDraft === settings.pause_message) ? 'rgba(92,58,33,0.15)' : '#2A1810', color: (pauseMsgDraft === settings.pause_message) ? '#5C3A21' : '#FAF1E4', border: 'none', borderRadius: '999px', padding: '0 22px', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500, cursor: (savingPause || pauseMsgDraft === settings.pause_message) ? 'default' : 'pointer' }}>
                Save
              </button>
            </div>
          </div>
        </div>

        {/* ── SOLD OUT ── */}
        <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.1)', borderRadius: '16px', padding: '22px', marginBottom: '32px' }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: '0 0 6px 0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '9px' }}>
            <Package size={18} /> Sold-out drinks
          </h2>
          <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', margin: '0 0 16px 0' }}>
            Tap a drink to mark it sold out. It stays on the menu but customers can't add it until you turn it back on.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
            {allDrinks.map(d => {
              const isSoldOut = settings.sold_out_drinks?.includes(d.id);
              return (
                <button key={d.id} onClick={() => toggleSoldOut(d.id)} disabled={savingDrink === d.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', textAlign: 'left', padding: '11px 13px', borderRadius: '10px', border: `1.5px solid ${isSoldOut ? '#A83A56' : 'rgba(92,58,33,0.15)'}`, background: isSoldOut ? 'rgba(168,58,86,0.08)' : '#FAF1E4', cursor: savingDrink === d.id ? 'wait' : 'pointer', transition: 'all 0.2s' }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', fontStyle: 'italic', color: '#2A1810', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span style={{ display: 'block', fontFamily: '"Outfit", sans-serif', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: isSoldOut ? '#A83A56' : '#5C3A21', fontWeight: 600, marginTop: '1px' }}>{isSoldOut ? 'Sold out' : 'Available'}</span>
                  </span>
                  <span style={{ flexShrink: 0, width: '16px', height: '16px', borderRadius: '4px', border: `1.5px solid ${isSoldOut ? '#A83A56' : 'rgba(92,58,33,0.3)'}`, background: isSoldOut ? '#A83A56' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isSoldOut && <X size={11} color="#FFFEFA" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <button onClick={() => setPage('pos')}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: '#2A1810', color: '#FAF1E4', border: 'none', borderRadius: '16px', padding: '20px 22px', cursor: 'pointer', marginBottom: '24px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '13px' }}>
            <Banknote size={22} />
            <span style={{ textAlign: 'left' }}>
              <span style={{ display: 'block', fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', fontStyle: 'italic', fontWeight: 600 }}>Open the till</span>
              <span style={{ display: 'block', fontFamily: '"Outfit", sans-serif', fontSize: '11.5px', opacity: 0.8 }}>Ring up a sale — cash or card</span>
            </span>
          </span>
          <ChevronRight size={19} />
        </button>

        <InPersonCharge />

        {isOwner && <CounterQr />}

        {isOwner && <SalesAnalytics />}

        </>}

        {/* ── ORDERS BOARD ── */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '26px', color: '#2A1810', margin: 0, fontWeight: 500 }}>Pickup orders</h2>
        </div>

        {/* Date selector */}
        <div className="cat-tabs" style={{ marginBottom: '18px' }}>
          {days.map(d => (
            <button key={d.iso} onClick={() => setDateIso(d.iso)}
              style={{ flexShrink: 0, padding: '9px 16px', borderRadius: '999px', border: `1.5px solid ${dateIso === d.iso ? '#2A1810' : 'rgba(92,58,33,0.2)'}`, background: dateIso === d.iso ? '#2A1810' : 'transparent', color: dateIso === d.iso ? '#FAF1E4' : '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.08em', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {d.isToday ? 'Today' : `${d.day} ${d.month} ${d.date}`}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '18px' }}>
          {[
            { label: 'Orders', value: orders.length },
            { label: 'To prep', value: pendingCount },
            { label: 'Net sales', value: `$${netSales.toFixed(2)}` },
            { label: 'Sales tax', value: `$${taxCollected.toFixed(2)}` },
            { label: 'Total taken', value: `$${revenue.toFixed(2)}` },
          ].map(s => (
            <div key={s.label} style={{ background: '#F0E2C9', borderRadius: '12px', padding: '14px 16px', textAlign: 'center' }}>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(22px, 5vw, 30px)', color: '#2A1810', fontWeight: 600, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '9px', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#5C3A21', marginTop: '5px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Orders list */}
        {loadingOrders ? (
          <div style={{ textAlign: 'center', padding: '40px' }}><Loader2 size={22} className="spin" color="#5C3A21" /></div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '18px', color: '#5C3A21' }}>
            No orders for this day yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {orders.map(o => (
              <div key={o.id} style={{ background: '#FFFEFA', border: `1px solid ${o.fulfilled ? 'rgba(61,122,79,0.4)' : 'rgba(92,58,33,0.12)'}`, borderRadius: '12px', padding: '16px 18px', opacity: o.fulfilled ? 0.7 : 1, transition: 'opacity 0.2s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', fontWeight: 600, color: '#2A1810' }}>
                        {o.pickup_time_display || o.pickup_time}
                      </span>
                      <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', fontStyle: 'italic', color: '#5C3A21' }}>
                        {o.customer?.name || 'Guest'}
                      </span>
                      {/* Every order is paid on the site, so anything not
                          'paid' is an abandoned/failed checkout — flag it
                          loudly so nobody makes a drink for free. */}
                      <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, padding: '3px 9px', borderRadius: '999px', background: o.payment_status === 'paid' ? 'rgba(61,122,79,0.15)' : 'rgba(168,58,86,0.15)', color: o.payment_status === 'paid' ? '#3D7A4F' : '#A83A56' }}>
                        {o.payment_status === 'paid'
                          ? (o.payment_method === 'cash' ? 'Paid · Cash' : 'Paid · Card')
                          : 'Unpaid — do not make'}
                      </span>
                      {(o.order_type === 'pos' || o.order_type === 'kiosk') && (
                        <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, padding: '3px 9px', borderRadius: '999px', background: 'rgba(92,58,33,0.1)', color: '#5C3A21' }}>
                          {o.order_type === 'kiosk' ? 'Kiosk' : 'Counter'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#3D2817', marginTop: '7px', lineHeight: 1.5 }}>
                      {itemsSummary(o.items)}
                    </div>
                    {o.customer?.phone && (
                      <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', marginTop: '4px' }}>{o.customer.phone}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
                    <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', fontWeight: 600, color: '#2A1810' }}>${(Number(o.total) || 0).toFixed(2)}</span>
                    <button onClick={() => toggleFulfilled(o)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: o.fulfilled ? 'rgba(61,122,79,0.12)' : '#2A1810', color: o.fulfilled ? '#3D7A4F' : '#FAF1E4', border: 'none', borderRadius: '999px', padding: '8px 16px', fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {o.fulfilled ? <><CheckCircle2 size={13} /> Done</> : <>Mark ready</>}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: '32px' }}>
          <button onClick={() => setPage('home')} data-compact style={{ background: 'none', border: 'none', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '16px', color: '#5C3A21', cursor: 'pointer', borderBottom: '1px solid #5C3A21', paddingBottom: '3px' }}>
            ← Back to site
          </button>
        </div>
      </div>
    </div>
  );
};

const Footer = ({ setPage }) => (
  <footer style={{ background: '#1A0F08', color: '#F0E2C9', padding: '48px 20px 28px 20px' }}>
    <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
      <div className="grid-3-md" style={{ marginBottom: '32px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <InfinityHeart size={26} color="#F0E2C9" />
            <span style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '28px', color: '#F0E2C9', lineHeight: 1 }}>Iced Intentions</span>
          </div>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', opacity: 0.7, lineHeight: 1.6, margin: 0 }}>
            Coffee, energy drinks & more — poured with intention since the day we opened.
          </p>
        </div>

        <div>
          <h5 style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.25em', textTransform: 'uppercase', margin: '0 0 12px 0', opacity: 0.7 }}>Find Us</h5>
          <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', lineHeight: 1.9 }}>
            <div>{BUSINESS.address}</div>
            <div>{BUSINESS.phone}</div>
            <div>{BUSINESS.instagram}</div>
          </div>
        </div>

        <div>
          <h5 style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.25em', textTransform: 'uppercase', margin: '0 0 12px 0', opacity: 0.7 }}>Explore</h5>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[{ id: 'home', label: 'Home' }, { id: 'order', label: 'Order Online' }].map(l => (
              <button key={l.id} onClick={() => setPage(l.id)} data-compact
                style={{ background: 'none', border: 'none', color: '#F0E2C9', fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', textAlign: 'left', cursor: 'pointer', padding: 0 }}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(240, 226, 201, 0.15)', paddingTop: '20px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', opacity: 0.6 }}>© {new Date().getFullYear()} Iced Intentions. All rights reserved.</span>
        <span style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', opacity: 0.7 }}>Made with <Heart size={11} fill="#E8A4B8" stroke="#E8A4B8" style={{ display: 'inline', verticalAlign: 'middle' }} /> in Bakersfield</span>
      </div>
    </div>
  </footer>
);

// ═══════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════
export default function App() {
  // Deep links from the printed counter QR (?instore=1) and from a
  // barista-created charge (?pay=<id>). Read once on load; the URL is then
  // tidied so a refresh doesn't replay a charge that's already been paid.
  const [entry] = useState(() => {
    if (typeof window === 'undefined') return { pay: null, inStore: false };
    const q = new URLSearchParams(window.location.search);
    return {
      pay: q.get('pay'),
      claim: q.get('claim'),
      inStore: q.get('instore') === '1',
      pos: q.get('pos') === '1',
      kiosk: q.get('kiosk') === '1',
    };
  });

  const [page, setPage] = useState(
    entry.kiosk ? 'kiosk'
      : entry.pos ? 'pos'
      : entry.claim ? 'claim'
      : entry.pay ? 'pay'
      : entry.inStore ? 'instore'
      : 'home',
  );
  const [inStoreMode, setInStoreMode] = useState(entry.inStore);
  const [cart, setCart] = useState([]);
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingReorder, setPendingReorder] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState(null); // 'owner' | 'staff' | null
  const [kioskPayId, setKioskPayId] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [highlightDrinkId, setHighlightDrinkId] = useState(null);

  // Track auth state across the whole app.
  useEffect(() => {
    const unsub = onAuthChange((u) => setUser(u));
    return unsub;
  }, []);

  // Detect owner/admin status whenever the user changes.
  useEffect(() => {
    let alive = true;
    if (user) {
      amIAdmin().then(ok => { if (alive) setIsAdmin(ok); });
      myRole().then(r => { if (alive) setRole(r); });
    } else {
      setIsAdmin(false);
      setRole(null);
    }
    return () => { alive = false; };
  }, [user]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [page]);

  // Drop ?pay=/?instore= from the address bar once we've read them, so a
  // refresh or a shared link doesn't land someone back on a stale charge.
  useEffect(() => {
    if ((entry.pay || entry.claim || entry.inStore || entry.pos || entry.kiosk) && window.history?.replaceState) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line

  const cartTotal = cart.reduce((sum, i) => sum + i.lineTotal, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const removeFromCart = (id) => setCart(cart.filter(c => c.id !== id));

  // Re-derive lineTotal rather than scaling it — scaling compounds any
  // rounding already baked into the stored value.
  const updateQty = (id, qty) => {
    if (qty < 1) { removeFromCart(id); return; }
    setCart(cart.map(i => {
      if (i.id !== id) return i;
      const addOnTotal = (i.addOns || []).reduce((s, aid) => s + (ADD_ONS.find(a => a.id === aid)?.price || 0), 0);
      return { ...i, qty, lineTotal: round2((i.basePrice + addOnTotal) * qty) };
    }));
  };

  // Send someone to a specific drink, not just the menu.
  const goToDrink = (drinkId) => {
    setInStoreMode(false);
    setHighlightDrinkId(drinkId);
    setPage('order');
  };

  // Re-order a saved favorite: add it straight to the cart and go to order page.
  const handleReorder = (drink) => {
    const basePrice = (drink.size === 'L' ? drink.priceL : drink.priceBucket) || 0;
    const addOnsTotal = (drink.addOnsData || []).reduce((s, a) => s + a.price, 0);
    const lineTotal = (basePrice + addOnsTotal) * (drink.qty || 1);
    const cartItem = {
      ...drink,
      id: `${drink.id}-${Date.now()}`,
      drinkId: drink.drinkId || drink.id,
      qty: drink.qty || 1,
      // basePrice must be carried on every cart item — the loyalty discount
      // picks the cheapest one, and a missing value poisons it to NaN.
      basePrice,
      sizeDisplay: sizeLabel(drink.drinkId || drink.id, drink.size),
      lineTotal,
    };
    setCart(prev => [...prev, cartItem]);
    setPage('order');
  };

  // If a signed-out user tries to reach the dashboard, prompt sign-in.
  // Navigating away from the scanned entry point drops in-store mode, so a
  // customer browsing on their own device doesn't silently skip scheduling.
  const navigate = (p) => { if (p !== 'order') setInStoreMode(false); setPage(p); };

  const goDashboard = () => {
    if (user) setPage('dashboard');
    else setAuthOpen(true);
  };

  // After sign-in, if they were trying to reach the dashboard, take them there.
  useEffect(() => {
    if (user && authOpen) { setAuthOpen(false); }
  }, [user]); // eslint-disable-line

  // Signing in from the counter QR is the last step of that landing screen,
  // so drop them onto the in-store menu the moment it succeeds.
  useEffect(() => {
    if (user && page === 'instore') setPage('order');
  }, [user, page]);

  // ── Full-screen staff/kiosk surfaces ──────────────────────────
  // These deliberately render WITHOUT the storefront nav and footer: the
  // kiosk sits unattended on a tablet and must offer no route into an
  // account or the dashboard, and the till wants the whole screen.
  const Busy = (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FAF1E4' }}>
      <Loader2 size={26} className="spin" color="#5C3A21" />
    </div>
  );

  if (page === 'kiosk') {
    return (
      <Suspense fallback={Busy}>
        <KioskPage onPayOnScreen={(id) => { setKioskPayId(id); setPage('pay'); }} />
      </Suspense>
    );
  }

  if (page === 'pos') {
    if (!user) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', background: '#FAF1E4', padding: '40px' }}>
          <Lock size={26} color="#5C3A21" />
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '19px', color: '#5C3A21', margin: 0 }}>
            Please sign in to open the till.
          </p>
          <button onClick={() => setAuthOpen(true)}
            style={{ background: '#2A1810', color: '#FAF1E4', padding: '14px 30px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
            Sign in
          </button>
          {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
        </div>
      );
    }
    if (!isAdmin) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', background: '#FAF1E4', padding: '40px', textAlign: 'center' }}>
          <Lock size={26} color="#5C3A21" />
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '19px', color: '#5C3A21', margin: 0 }}>
            This till is for Iced Intentions staff.
          </p>
          <button onClick={() => setPage('home')}
            style={{ background: '#2A1810', color: '#FAF1E4', padding: '12px 26px', borderRadius: '999px', border: 'none', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
            Back home
          </button>
        </div>
      );
    }
    return (
      <Suspense fallback={Busy}>
        <PosPage role={role} onExit={() => setPage(role === 'owner' ? 'owner' : 'home')} />
      </Suspense>
    );
  }

  return (
    <div style={{ background: '#FAF1E4', minHeight: '100vh', overflowX: 'hidden', maxWidth: '100%' }}>
      <Nav page={page} setPage={navigate} user={user} onAccount={goDashboard} onSignIn={() => setAuthOpen(true)} />
      <div className="fade-in" key={page}>
        {page === 'home' && <HomePage setPage={setPage} onSignIn={() => setAuthOpen(true)} user={user} onOrderDrink={goToDrink} />}
        {page === 'order' && (
          <OrderPage
            cart={cart} setCart={setCart} user={user} onSignIn={() => setAuthOpen(true)} inStore={inStoreMode}
            cartOpen={cartOpen} setCartOpen={setCartOpen}
            showCheckout={showCheckout} setShowCheckout={setShowCheckout}
            updateQty={updateQty}
            highlightDrinkId={highlightDrinkId} onHighlightDone={() => setHighlightDrinkId(null)}
          />
        )}
        {page === 'instore' && (
          <InStoreLanding
            user={user}
            onSignIn={() => setAuthOpen(true)}
            onContinue={() => setPage('order')}
          />
        )}
        {page === 'claim' && (
          <ClaimStampPage
            orderId={entry.claim}
            user={user}
            onSignIn={() => setAuthOpen(true)}
            onDone={() => setPage(user ? 'dashboard' : 'home')}
          />
        )}
        {page === 'pay' && (
          <ScanToPayPage
            orderId={kioskPayId || entry.pay}
            user={user}
            onSignIn={() => setAuthOpen(true)}
            onDone={() => { setPage(user ? 'dashboard' : 'order'); }}
          />
        )}
        {page === 'dashboard' && user && <DashboardPage user={user} setPage={setPage} onReorder={handleReorder} isAdmin={isAdmin} />}
        {page === 'dashboard' && !user && <HomePage setPage={setPage} onSignIn={() => setAuthOpen(true)} user={user} onOrderDrink={goToDrink} />}
        {page === 'owner' && <OwnerDashboard user={user} setPage={setPage} role={role} />}
      </div>
      <Footer setPage={navigate} />

      {/* Cart follows across pages. Hidden during checkout (it would sit on
          top of the pay bar) and on the counter/kiosk flows, which have
          nothing to do with a pickup basket. */}
      {cart.length > 0 && !showCheckout && ['home', 'order', 'dashboard'].includes(page) && (
        <>
          <button onClick={() => setCartOpen(true)} className="mobile-cart-bar" style={{ border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShoppingBag size={22} color="#FAF1E4" />
                <span style={{ position: 'absolute', top: -6, right: -8, background: '#E8A4B8', color: '#2A1810', fontSize: '10px', fontWeight: 700, minWidth: '18px', height: '18px', padding: '0 4px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                  {cartCount}
                </span>
              </div>
              <div>
                <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.7 }}>Your Cart</div>
                <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', fontWeight: 600 }}>${cartTotal.toFixed(2)}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500 }}>
              View <ChevronRight size={16} />
            </div>
          </button>

          <button onClick={() => setCartOpen(true)} className="cart-fab">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShoppingBag size={20} color="#FAF1E4" />
              <span style={{ position: 'absolute', top: -8, right: -10, background: '#E8A4B8', color: '#2A1810', fontSize: '10px', fontWeight: 700, minWidth: '18px', height: '18px', padding: '0 4px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                {cartCount}
              </span>
            </div>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '19px', fontWeight: 600 }}>${cartTotal.toFixed(2)}</span>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 500, opacity: 0.85 }}>View cart</span>
          </button>
        </>
      )}

      {cartOpen && (
        <CartDrawer
          cart={cart} cartTotal={cartTotal}
          onClose={() => setCartOpen(false)}
          onRemove={removeFromCart}
          onCheckout={() => { setCartOpen(false); setPage('order'); setShowCheckout(true); }}
          onBrowse={() => { setCartOpen(false); setPage('order'); }}
        />
      )}

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
