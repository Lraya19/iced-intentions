import React, { useState, useEffect, useMemo } from 'react';
import {
  Heart, ShoppingBag, Calendar, Clock, MapPin, Phone, Instagram,
  ChevronRight, ChevronLeft, X, Plus, Minus, Check, Sparkles,
  Coffee, Star, Loader2, Menu as MenuIcon,
} from 'lucide-react';
import { subscribeToSlots, bookSlot, subscribeToEventDates, bookEvent, saveOrder } from './storage';
import { sendOrderEmail, sendEventEmail } from './email';

// ═══════════════════════════════════════════════════════
// PUBLIC BUSINESS CONFIG (read from env)
// ═══════════════════════════════════════════════════════
const BUSINESS = {
  name: 'Iced Intentions',
  phone: import.meta.env.VITE_BUSINESS_PHONE || '(972) 555-0142',
  address: import.meta.env.VITE_BUSINESS_ADDRESS || '1247 Las Colinas Blvd, Irving, TX 75039',
  instagram: import.meta.env.VITE_BUSINESS_INSTAGRAM || '@icedintentions',
  hours: {
    weekday: '7:00 AM – 6:00 PM',
    saturday: '8:00 AM – 7:00 PM',
    sunday: '8:00 AM – 4:00 PM',
  },
};

// ═══════════════════════════════════════════════════════
// MENU
// ═══════════════════════════════════════════════════════
const MENU = {
  matcha: {
    title: 'Matcha',
    note: 'All matchas made with oatmilk',
    items: [
      { id: 'matcha-verdi', name: 'Matcha Verdí', desc: 'Pure ceremonial-grade matcha, oatmilk, kissed with vanilla', priceL: 9.50, priceBucket: 17.00, gradient: 'linear-gradient(180deg, #F5F0DC 0%, #B5C99A 50%, #6B8E4E 100%)' },
      { id: 'matcha-besitos', name: 'Matcha Besitos', desc: 'Matcha layered with Biscoff cookie crumble & soft top', priceL: 9.50, priceBucket: 17.00, gradient: 'linear-gradient(180deg, #E8C896 0%, #B5C99A 40%, #6B8E4E 100%)' },
      { id: 'matcha-blanqui', name: 'Matcha Blanquí', desc: 'White chocolate matcha dream, silky and sweet', priceL: 9.50, priceBucket: 17.00, gradient: 'linear-gradient(180deg, #FFF8E7 0%, #D4DEAB 50%, #8FA968 100%)' },
      { id: 'matcha-rosa', name: 'Matcha Rosa', desc: 'Strawberry compote pooled beneath jade matcha', priceL: 9.50, priceBucket: 17.00, gradient: 'linear-gradient(180deg, #B5C99A 0%, #B5C99A 45%, #FFE4D6 60%, #C8345A 100%)' },
    ],
  },
  lattes: {
    title: 'Lattes',
    items: [
      { id: 'dulce-moonkiss', name: 'Dulce Moon-Kiss', desc: 'Espresso, vanilla cream, brown sugar, dusted cinnamon', priceL: 8.00, priceBucket: 15.00, gradient: 'linear-gradient(180deg, #F5E6D3 0%, #C8A57A 50%, #6B4423 100%)' },
      { id: 'mornenita-mornings', name: 'Mornenita Mornings', desc: 'Velvet caramel ribbons, espresso, sea salt foam', priceL: 8.00, priceBucket: 15.00, gradient: 'linear-gradient(180deg, #FFF1DC 0%, #E8A85C 40%, #8B5E2C 100%)' },
      { id: 'nube-blush', name: 'Nube Blush', desc: 'Rose-petal latte, oat foam, edible blossom', priceL: 8.00, priceBucket: 15.00, gradient: 'linear-gradient(180deg, #FFE4E1 0%, #E8A4B8 50%, #C18298 100%)' },
      { id: 'besitos-brunette', name: 'Besitos Brunette', desc: 'Double espresso, dulce de leche, Biscoff crumble', priceL: 8.00, priceBucket: 15.00, gradient: 'linear-gradient(180deg, #D4A574 0%, #8B5E2C 50%, #4A2C17 100%)' },
    ],
  },
  refreshers: {
    title: 'Lemonades & Refreshers',
    sizeNote: '32 oz / 24 oz',
    items: [
      { id: 'tropic-bonita', name: 'Tropic Bonita', desc: 'Mango, passionfruit, hibiscus lemonade', priceL: 8.00, priceBucket: 8.00, gradient: 'linear-gradient(180deg, #FFD4A3 0%, #FFA76C 50%, #E85D3C 100%)' },
      { id: 'sunkissed-cielo', name: 'SunKissed Cielo', desc: 'Peach, guava, sparkling lemon clouds', priceL: 8.00, priceBucket: 8.00, gradient: 'linear-gradient(180deg, #FFE4B5 0%, #FFB87A 50%, #FF8B4A 100%)' },
      { id: 'coquetta-crush', name: 'Coquetta Crush', desc: 'Strawberry-rose lemonade, coconut foam', priceL: 9.00, priceBucket: 9.00, gradient: 'linear-gradient(180deg, #FFF0F0 0%, #FFB8C8 50%, #E8557A 100%)' },
      { id: 'summer-chula', name: 'Summer Chula', desc: 'Watermelon-lime, basil, chamoy rim', priceL: 9.00, priceBucket: 9.00, gradient: 'linear-gradient(180deg, #FFC8C8 0%, #FF7A8C 50%, #C73456 100%)' },
    ],
  },
  energy: {
    title: 'Energy Drinks',
    items: [
      { id: 'paraiso-fuse', name: 'Paraíso Fuse', desc: 'Tropical paradise, coconut, pineapple lift', priceL: 8.00, priceBucket: 12.00, gradient: 'linear-gradient(180deg, #FFEBC4 0%, #FFD17A 50%, #FFA630 100%)' },
      { id: 'cremita-fuse', name: 'Cremita Fuse', desc: 'Horchata cream, cinnamon, energy boost', priceL: 8.00, priceBucket: 12.00, gradient: 'linear-gradient(180deg, #FFF5E1 0%, #F5DDB3 50%, #C9A86A 100%)' },
      { id: 'azulita-fuse', name: 'Azulita Fuse', desc: 'Blue raspberry, coconut cream, pop rocks', priceL: 8.00, priceBucket: 12.00, gradient: 'linear-gradient(180deg, #B8F0E8 0%, #5DD4C5 50%, #2BA89A 100%)' },
      { id: 'verde-fuse', name: 'Verde Fuse', desc: 'Kiwi, lime, mint, vibrant green energy', priceL: 8.00, priceBucket: 12.00, gradient: 'linear-gradient(180deg, #DEF5C9 0%, #95D478 50%, #4A9B2D 100%)' },
    ],
  },
};

const ADD_ONS = [
  { id: 'oatmilk', name: 'Oatmilk', price: 0.75 },
  { id: 'extra-shot', name: 'Extra Shot', price: 0.75 },
  { id: 'chamoy', name: 'Chamoy', price: 0.75 },
  { id: 'extra-matcha', name: 'Extra Matcha', price: 1.00 },
  { id: 'custom-print', name: 'Custom Print', price: 5.00 },
];

const SIZES = [
  { id: 'L', label: 'Large (24 oz)' },
  { id: 'BUCKET', label: 'Bucket (32 oz)' },
];

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════
const generateTimeSlots = () => {
  const slots = [];
  for (let h = 9; h <= 17; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 17 && m > 45) break;
      const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const display = `${((h - 1) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
      slots.push({ time, display });
    }
  }
  return slots;
};

const getNextSevenDays = () => {
  const days = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({
      iso: d.toISOString().split('T')[0],
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
const InfinityHeart = ({ size = 40, color = '#2A1810' }) => (
  <svg width={size} height={size * 0.65} viewBox="0 0 100 65" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M 50 32 C 35 5, 5 15, 15 32 C 25 50, 50 35, 50 50 C 50 35, 75 50, 85 32 C 95 15, 65 5, 50 32 Z"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M 50 47 L 47 50 Q 44 53, 47 56 Q 50 59, 50 62 Q 50 59, 53 56 Q 56 53, 53 50 Z"
      fill={color}
    />
  </svg>
);

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

const DrinkVisual = ({ gradient, size = 'md' }) => {
  const dims = size === 'sm' ? { w: 80, h: 130 } : size === 'lg' ? { w: 180, h: 280 } : { w: 130, h: 200 };
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
const Nav = ({ page, setPage, cartCount }) => {
  const [open, setOpen] = useState(false);
  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'order', label: 'Order' },
    { id: 'events', label: 'Events' },
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
          <button
            onClick={() => setPage('order')}
            className="nav-cart-desktop"
            style={{
              alignItems: 'center', gap: '8px',
              background: '#2A1810', color: '#FAF1E4',
              padding: '10px 22px', borderRadius: '999px', border: 'none',
              fontFamily: '"Outfit", sans-serif', fontSize: '13px',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              fontWeight: 500, cursor: 'pointer', position: 'relative',
            }}
          >
            <ShoppingBag size={14} />
            Cart
            {cartCount > 0 && (
              <span style={{ background: '#E8A4B8', color: '#2A1810', fontSize: '11px', fontWeight: 700, width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {cartCount}
              </span>
            )}
          </button>

          {/* Mobile: cart icon + hamburger */}
          <div className="nav-mobile-controls">
            <button
              onClick={() => setPage('order')}
              data-compact
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="View cart"
            >
              <ShoppingBag size={22} color="#2A1810" />
              {cartCount > 0 && (
                <span style={{ position: 'absolute', top: 4, right: 2, background: '#E8A4B8', color: '#2A1810', fontSize: '10px', fontWeight: 700, minWidth: '18px', height: '18px', padding: '0 4px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                  {cartCount}
                </span>
              )}
            </button>
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
        </div>
      )}
    </nav>
  );
};

// ═══════════════════════════════════════════════════════
// HOME PAGE
// ═══════════════════════════════════════════════════════
const HomePage = ({ setPage }) => {
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
            <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(48px, 11vw, 128px)', lineHeight: 0.95, color: '#2A1810', margin: '0 0 8px 0', fontWeight: 400 }}>
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
              <button onClick={() => setPage('events')} style={{ background: 'transparent', color: '#2A1810', padding: '14px 28px', borderRadius: '999px', border: '1.5px solid #2A1810', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer' }}>
                Book an Event
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

          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '320px', marginTop: '20px' }}>
            <div style={{ position: 'absolute', top: '8%', left: '15%', transform: 'rotate(-6deg)', opacity: 0.85 }}>
              <DrinkVisual gradient={MENU.matcha.items[3].gradient} size="sm" />
            </div>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <DrinkVisual gradient={MENU.lattes.items[1].gradient} size="md" />
            </div>
            <div style={{ position: 'absolute', bottom: '8%', right: '12%', transform: 'rotate(8deg)', opacity: 0.85 }}>
              <DrinkVisual gradient={MENU.energy.items[2].gradient} size="sm" />
            </div>
            <Sparkles size={18} style={{ position: 'absolute', top: '15%', right: '20%', color: '#E8A4B8' }} />
            <Heart size={14} style={{ position: 'absolute', bottom: '25%', left: '15%', color: '#E8A4B8', fill: '#E8A4B8' }} />
          </div>
        </div>
      </section>

      {/* STORY */}
      <section className="section-pad" style={{ background: '#F0E2C9', position: 'relative' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <Ornament width={240} />
          <h2 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(40px, 9vw, 80px)', color: '#2A1810', margin: '20px 0 8px 0', fontWeight: 400, lineHeight: 1 }}>
            our little story
          </h2>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(16px, 4vw, 22px)', lineHeight: 1.7, color: '#3D2817', margin: '24px 0', fontStyle: 'italic' }}>
            Born from late-night conversations and a deep love for cafecito culture, Iced Intentions is more than a drink stop — it's a slow morning, a kiss before work, a Sunday afternoon spilled across the counter. Every recipe carries a small intention: <em>verdí</em> for grounding, <em>besitos</em> for sweetness, <em>cielo</em> for the kind of day that feels like sky.
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
                style={{ background: '#FFFEFA', padding: '24px 16px', borderRadius: '4px', textAlign: 'center', position: 'relative', transition: 'transform 0.4s, box-shadow 0.4s', cursor: 'pointer', boxShadow: '0 1px 3px rgba(42, 24, 16, 0.06)', border: '1px solid rgba(92, 58, 33, 0.08)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-6px)';
                  e.currentTarget.style.boxShadow = '0 12px 32px rgba(42, 24, 16, 0.12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(42, 24, 16, 0.06)';
                }}
              >
                <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.25em', textTransform: 'uppercase', color: '#E8A4B8', fontWeight: 600 }}>{drink.category}</span>
                <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
                  <DrinkVisual gradient={drink.gradient} size="md" />
                </div>
                <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', color: '#2A1810', margin: '0 0 8px 0', fontWeight: 500, fontStyle: 'italic' }}>{drink.name}</h3>
                <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', lineHeight: 1.5, margin: '0 0 14px 0', minHeight: '36px' }}>{drink.desc}</p>
                <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', color: '#2A1810', fontWeight: 600 }}>${drink.priceL.toFixed(2)}</div>
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
                  { day: 'Mon — Fri', hours: BUSINESS.hours.weekday },
                  { day: 'Saturday', hours: BUSINESS.hours.saturday },
                  { day: 'Sunday', hours: BUSINESS.hours.sunday },
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
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// CHECKOUT INPUT
// ═══════════════════════════════════════════════════════
const CheckoutInput = ({ label, value, onChange, placeholder, type = 'text' }) => (
  <div>
    <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '6px' }}>{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', padding: '12px 14px', borderRadius: '4px', border: '1.5px solid rgba(92, 58, 33, 0.2)', background: '#FAF1E4', fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810', outline: 'none' }}
      onFocus={(e) => e.target.style.borderColor = '#E8A4B8'}
      onBlur={(e) => e.target.style.borderColor = 'rgba(92, 58, 33, 0.2)'}
    />
  </div>
);

// ═══════════════════════════════════════════════════════
// DRINK CUSTOMIZER MODAL
// ═══════════════════════════════════════════════════════
const DrinkCustomizer = ({ drink, onClose, onAdd }) => {
  const [size, setSize] = useState('L');
  const [addOns, setAddOns] = useState([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  const toggleAddOn = (id) => setAddOns(addOns.includes(id) ? addOns.filter(a => a !== id) : [...addOns, id]);

  const basePrice = size === 'L' ? drink.priceL : drink.priceBucket;
  const addOnTotal = addOns.reduce((s, id) => s + (ADD_ONS.find(a => a.id === id)?.price || 0), 0);
  const total = (basePrice + addOnTotal) * qty;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content slide-up" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(255, 254, 250, 0.95)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }} aria-label="Close">
          <X size={20} color="#2A1810" />
        </button>
        <div style={{ background: drink.gradient, padding: '32px 20px 16px 20px', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
          <DrinkVisual gradient={drink.gradient} size="md" />
        </div>
        <div style={{ padding: '24px 20px' }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 'clamp(26px, 6vw, 32px)', color: '#2A1810', margin: '0 0 8px 0', fontWeight: 500, fontStyle: 'italic' }}>{drink.name}</h2>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#5C3A21', margin: '0 0 20px 0', lineHeight: 1.5 }}>{drink.desc}</p>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '10px' }}>Size</label>
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

          <button onClick={() => onAdd(drink, size, addOns, qty, notes)}
            style={{ width: '100%', background: '#2A1810', color: '#FAF1E4', padding: '16px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <Plus size={14} /> Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// CHECKOUT FLOW
// ═══════════════════════════════════════════════════════
const CheckoutFlow = ({ cart, cartTotal, onBack, onComplete }) => {
  const [selectedDate, setSelectedDate] = useState(getNextSevenDays()[0].iso);
  const [selectedTime, setSelectedTime] = useState(null);
  const [bookedSlots, setBookedSlots] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [customerInfo, setCustomerInfo] = useState({ name: '', phone: '', email: '' });
  const [error, setError] = useState('');

  const days = useMemo(() => getNextSevenDays(), []);
  const allSlots = useMemo(() => generateTimeSlots(), []);

  // Real-time subscribe to slot updates for the selected date
  useEffect(() => {
    setBookedSlots({});
    const unsubscribe = subscribeToSlots(selectedDate, (slots) => {
      setBookedSlots(slots);
    });
    return unsubscribe;
  }, [selectedDate]);

  const isSlotTaken = (time) => Boolean(bookedSlots[time]);

  const handleSubmit = async () => {
    setError('');
    if (!selectedTime) { setError('Please choose a pickup time.'); return; }
    if (!customerInfo.name || !customerInfo.phone) { setError('Name and phone are required.'); return; }

    setSubmitting(true);
    try {
      // Atomic transaction prevents two customers grabbing the same slot
      await bookSlot(selectedDate, selectedTime, customerInfo.name);

      const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const order = {
        id: orderId,
        placedAt: new Date().toISOString(),
        pickupDate: selectedDate,
        pickupTime: selectedTime,
        pickupTimeDisplay: allSlots.find(s => s.time === selectedTime)?.display,
        customer: customerInfo,
        items: cart,
        total: cartTotal,
      };

      await saveOrder(orderId, order);

      try { await sendOrderEmail(order); } catch (e) { console.warn('Email send failed:', e); }

      setSubmitting(false);
      onComplete(order);
    } catch (err) {
      setSubmitting(false);
      if (err.message === 'SLOT_TAKEN') {
        setError('That time was just booked by someone else. Please pick another.');
        setSelectedTime(null);
      } else {
        setError('Something went wrong. Please try again.');
        console.error(err);
      }
    }
  };

  return (
    <div style={{ background: '#FAF1E4', minHeight: '100vh' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 20px 60px 20px' }}>
        <button onClick={onBack} data-compact style={{ background: 'none', border: 'none', color: '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px', padding: '8px 0' }}>
          <ChevronLeft size={16} /> Back to menu
        </button>

        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>Checkout</span>
          <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(40px, 9vw, 72px)', color: '#2A1810', margin: '6px 0 0 0', fontWeight: 400, lineHeight: 1 }}>
            Almost yours
          </h1>
        </div>

        <div style={{ background: '#FFFEFA', padding: '20px', borderRadius: '4px', marginBottom: '16px', border: '1px solid rgba(92, 58, 33, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Calendar size={18} color="#2A1810" />
            <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', color: '#2A1810', margin: 0, fontWeight: 500 }}>Pickup Date</h3>
          </div>
          <div className="h-scroll">
            {days.map(d => (
              <button key={d.iso} onClick={() => { setSelectedDate(d.iso); setSelectedTime(null); }}
                style={{ padding: '12px 16px', borderRadius: '4px', border: `1.5px solid ${selectedDate === d.iso ? '#2A1810' : 'rgba(92, 58, 33, 0.15)'}`, background: selectedDate === d.iso ? '#2A1810' : 'transparent', color: selectedDate === d.iso ? '#FAF1E4' : '#2A1810', cursor: 'pointer', textAlign: 'center', minWidth: '68px', transition: 'all 0.2s' }}>
                <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.8 }}>{d.day}</div>
                <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', fontWeight: 600, lineHeight: 1, marginTop: '4px' }}>{d.date}</div>
                <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', marginTop: '4px', opacity: 0.7 }}>{d.month}{d.isToday ? ' · Today' : ''}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: '#FFFEFA', padding: '20px', borderRadius: '4px', marginBottom: '16px', border: '1px solid rgba(92, 58, 33, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <Clock size={18} color="#2A1810" />
            <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', color: '#2A1810', margin: 0, fontWeight: 500 }}>Pickup Time</h3>
          </div>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', color: '#5C3A21', margin: '0 0 14px 0' }}>
            15-minute windows. Taken slots disappear in real time.
          </p>

          <div style={{ display: 'grid', gap: '6px', gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))' }}>
            {allSlots.filter(s => !isSlotTaken(s.time)).map(slot => {
              const selected = selectedTime === slot.time;
              return (
                <button key={slot.time} onClick={() => setSelectedTime(slot.time)} data-compact
                  style={{ padding: '12px 6px', borderRadius: '3px', border: `1.5px solid ${selected ? '#E8A4B8' : 'rgba(92, 58, 33, 0.15)'}`, background: selected ? '#E8A4B8' : '#FAF1E4', color: '#2A1810', fontFamily: '"Outfit", sans-serif', fontSize: '12px', fontWeight: selected ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {slot.display}
                </button>
              );
            })}
          </div>
          {allSlots.every(s => isSlotTaken(s.time)) && (
            <p style={{ textAlign: 'center', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', color: '#5C3A21', padding: '20px' }}>
              All time slots are booked for this day. Please pick another day.
            </p>
          )}
        </div>

        <div style={{ background: '#FFFEFA', padding: '20px', borderRadius: '4px', marginBottom: '16px', border: '1px solid rgba(92, 58, 33, 0.1)' }}>
          <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', color: '#2A1810', margin: '0 0 16px 0', fontWeight: 500 }}>Your Info</h3>
          <div style={{ display: 'grid', gap: '14px' }}>
            <CheckoutInput label="Full Name *" value={customerInfo.name} onChange={(v) => setCustomerInfo({ ...customerInfo, name: v })} />
            <CheckoutInput label="Phone *" value={customerInfo.phone} onChange={(v) => setCustomerInfo({ ...customerInfo, phone: v })} placeholder="(972) 555-0100" />
            <CheckoutInput label="Email" value={customerInfo.email} onChange={(v) => setCustomerInfo({ ...customerInfo, email: v })} placeholder="for receipt (optional)" type="email" />
          </div>
        </div>

        <div style={{ background: '#F0E2C9', padding: '20px', borderRadius: '4px', marginBottom: '20px', border: '1px solid rgba(92, 58, 33, 0.12)' }}>
          <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', color: '#2A1810', margin: '0 0 14px 0', fontWeight: 500 }}>Order Summary</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {cart.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
                <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#2A1810', fontStyle: 'italic' }}>
                  {item.qty}× {item.name} <span style={{ fontSize: '12px', opacity: 0.7 }}>({item.size})</span>
                </span>
                <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#2A1810', fontWeight: 600, flexShrink: 0 }}>${item.lineTotal.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid rgba(92, 58, 33, 0.2)', marginTop: '14px', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Total</span>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '28px', color: '#2A1810', fontWeight: 600 }}>${cartTotal.toFixed(2)}</span>
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(232, 85, 122, 0.1)', border: '1px solid rgba(232, 85, 122, 0.3)', padding: '14px', borderRadius: '4px', marginBottom: '16px', fontFamily: '"Outfit", sans-serif', fontSize: '14px', color: '#A83A56' }}>
            {error}
          </div>
        )}

        <button onClick={handleSubmit} disabled={submitting}
          style={{ width: '100%', background: submitting ? '#5C3A21' : '#2A1810', color: '#FAF1E4', padding: '18px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: submitting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          {submitting ? <><Loader2 size={16} className="spin" /> Placing Order...</> : <>Place Order <Heart size={14} fill="#E8A4B8" stroke="#E8A4B8" /></>}
        </button>

        <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', color: '#5C3A21', textAlign: 'center', marginTop: '14px' }}>
          You'll get a confirmation. We'll have it ready right at your time.
        </p>
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
        <div style={{ borderTop: '1px solid rgba(92, 58, 33, 0.2)', marginTop: '14px', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Total</span>
          <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', fontWeight: 600 }}>${order.total.toFixed(2)}</span>
        </div>
      </div>

      <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '14px', color: '#5C3A21', marginBottom: '24px' }}>
        Pay at pickup. We can't wait to see you.
      </p>

      <button onClick={onClose} style={{ background: '#2A1810', color: '#FAF1E4', padding: '14px 32px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer' }}>
        Order Again
      </button>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════
// ORDER PAGE
// ═══════════════════════════════════════════════════════
const OrderPage = ({ cart, setCart }) => {
  const [activeCategory, setActiveCategory] = useState('matcha');
  const [selectedDrink, setSelectedDrink] = useState(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  const cartTotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);

  const addToCart = (drink, size, addOns, qty, notes) => {
    const basePrice = size === 'L' ? drink.priceL : drink.priceBucket;
    const addOnTotal = addOns.reduce((s, id) => s + (ADD_ONS.find(a => a.id === id)?.price || 0), 0);
    const lineTotal = (basePrice + addOnTotal) * qty;
    setCart([...cart, {
      id: `${drink.id}-${Date.now()}`, drinkId: drink.id, name: drink.name,
      gradient: drink.gradient, size, addOns, qty, notes, basePrice, lineTotal,
    }]);
    setSelectedDrink(null);
  };

  const removeFromCart = (id) => setCart(cart.filter(c => c.id !== id));

  if (confirmation) {
    return <OrderConfirmation order={confirmation} onClose={() => { setConfirmation(null); setCart([]); }} />;
  }
  if (showCheckout) {
    return <CheckoutFlow cart={cart} cartTotal={cartTotal} onBack={() => setShowCheckout(false)} onComplete={(order) => { setConfirmation(order); setShowCheckout(false); }} />;
  }

  return (
    <div className={cart.length > 0 ? 'order-page-has-cart' : ''} style={{ background: '#FAF1E4', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>Order Online</span>
          <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(48px, 11vw, 96px)', color: '#2A1810', margin: '8px 0 4px 0', fontWeight: 400, lineHeight: 1 }}>
            Build your sip
          </h1>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: 'clamp(15px, 3.5vw, 18px)', color: '#5C3A21', marginTop: '12px' }}>
            Choose your drink, customize, pick your pickup time.
          </p>
        </div>

        <div className="order-grid">
          <div>
            <div className="h-scroll" style={{ marginBottom: '24px' }}>
              {Object.entries(MENU).map(([key, cat]) => (
                <button key={key} onClick={() => setActiveCategory(key)}
                  style={{ padding: '10px 18px', borderRadius: '999px', border: '1.5px solid #2A1810', background: activeCategory === key ? '#2A1810' : 'transparent', color: activeCategory === key ? '#FAF1E4' : '#2A1810', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                  {cat.title}
                </button>
              ))}
            </div>

            <div className="grid-2-sm">
              {MENU[activeCategory].items.map(drink => (
                <button key={drink.id} onClick={() => setSelectedDrink(drink)}
                  style={{ background: '#FFFEFA', border: '1px solid rgba(92, 58, 33, 0.1)', borderRadius: '4px', padding: '18px', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: '16px', alignItems: 'center', transition: 'all 0.3s', boxShadow: '0 1px 3px rgba(42, 24, 16, 0.04)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#E8A4B8';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(42, 24, 16, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(92, 58, 33, 0.1)';
                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(42, 24, 16, 0.04)';
                  }}>
                  <div style={{ flexShrink: 0 }}>
                    <DrinkVisual gradient={drink.gradient} size="sm" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', color: '#2A1810', margin: '0 0 6px 0', fontWeight: 500, fontStyle: 'italic' }}>{drink.name}</h3>
                    <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', lineHeight: 1.5, margin: '0 0 10px 0' }}>{drink.desc}</p>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810', fontWeight: 600 }}>${drink.priceL.toFixed(2)}</span>
                      <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', color: '#5C3A21', letterSpacing: '0.1em' }}>L</span>
                      {drink.priceBucket !== drink.priceL && (
                        <>
                          <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '16px', color: '#2A1810', fontWeight: 600, marginLeft: '8px' }}>${drink.priceBucket.toFixed(2)}</span>
                          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', color: '#5C3A21', letterSpacing: '0.1em' }}>BUCKET</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="cart-sticky">
            <div style={{ background: '#F0E2C9', borderRadius: '4px', padding: '24px', border: '1px solid rgba(92, 58, 33, 0.12)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
                <ShoppingBag size={18} color="#2A1810" />
                <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', color: '#2A1810', margin: 0, fontWeight: 500 }}>Your Cart</h3>
              </div>

              {cart.length === 0 ? (
                <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', color: '#5C3A21', fontSize: '15px', textAlign: 'center', padding: '20px 0' }}>
                  Your cart is waiting for love letters.
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto', marginBottom: '14px' }}>
                    {cart.map(item => (
                      <div key={item.id} style={{ background: '#FFFEFA', padding: '14px', borderRadius: '3px', position: 'relative' }}>
                        <button onClick={() => removeFromCart(item.id)} data-compact style={{ position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#5C3A21', padding: '4px' }} aria-label="Remove">
                          <X size={14} />
                        </button>
                        <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '17px', color: '#2A1810', fontStyle: 'italic', fontWeight: 500, paddingRight: '22px' }}>
                          {item.name}
                        </div>
                        <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', color: '#5C3A21', marginTop: '4px', letterSpacing: '0.05em' }}>
                          {item.size === 'L' ? 'Large' : 'Bucket'} · Qty {item.qty}
                          {item.addOns.length > 0 && ` · +${item.addOns.length}`}
                        </div>
                        {item.notes && (
                          <div style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '13px', color: '#5C3A21', marginTop: '4px' }}>
                            "{item.notes}"
                          </div>
                        )}
                        <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '15px', color: '#2A1810', marginTop: '6px', fontWeight: 600 }}>
                          ${item.lineTotal.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid rgba(92, 58, 33, 0.2)', paddingTop: '14px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Subtotal</span>
                      <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '26px', color: '#2A1810', fontWeight: 600 }}>${cartTotal.toFixed(2)}</span>
                    </div>
                  </div>
                  <button onClick={() => setShowCheckout(true)}
                    style={{ width: '100%', background: '#2A1810', color: '#FAF1E4', padding: '16px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    Checkout <ChevronRight size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile floating cart bar */}
      {cart.length > 0 && (
        <button onClick={() => setShowCheckout(true)} className="mobile-cart-bar" style={{ border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShoppingBag size={22} color="#FAF1E4" />
              <span style={{ position: 'absolute', top: -6, right: -8, background: '#E8A4B8', color: '#2A1810', fontSize: '10px', fontWeight: 700, minWidth: '18px', height: '18px', padding: '0 4px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                {cart.reduce((s, i) => s + i.qty, 0)}
              </span>
            </div>
            <div>
              <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.7 }}>Your Cart</div>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', fontWeight: 600 }}>${cartTotal.toFixed(2)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500 }}>
            Checkout <ChevronRight size={16} />
          </div>
        </button>
      )}

      {selectedDrink && <DrinkCustomizer drink={selectedDrink} onClose={() => setSelectedDrink(null)} onAdd={addToCart} />}
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// EVENTS PAGE
// ═══════════════════════════════════════════════════════
const EventsPage = () => {
  const [eventType, setEventType] = useState('private');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('2');
  const [guests, setGuests] = useState('');
  const [info, setInfo] = useState({ name: '', email: '', phone: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [bookedDates, setBookedDates] = useState({});

  const eventTypes = [
    { id: 'private', label: 'Private Party', icon: Heart, desc: 'Birthdays, baby showers, Galentine\'s, anything sweet', from: 250 },
    { id: 'wedding', label: 'Wedding', icon: Sparkles, desc: 'Custom drink menu, your monogram, soft top forever', from: 600 },
    { id: 'corporate', label: 'Corporate', icon: Coffee, desc: 'Office mornings, conferences, client appreciation', from: 350 },
    { id: 'pop-up', label: 'Pop-Up Booth', icon: Star, desc: 'Markets, festivals, brand activations', from: 450 },
  ];

  // Subscribe to booked event dates in real-time
  useEffect(() => {
    const unsubscribe = subscribeToEventDates((dates) => setBookedDates(dates));
    return unsubscribe;
  }, []);

  const handleSubmit = async () => {
    setError('');
    if (!date || !time || !info.name || !info.email || !info.phone) {
      setError('Please fill in all required fields.');
      return;
    }
    if (bookedDates[date]) {
      setError('That date is already booked. Please pick another.');
      return;
    }

    setSubmitting(true);
    const booking = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      submittedAt: new Date().toISOString(),
      eventType, date, time, duration, guests, ...info, booked: true,
    };

    try {
      await bookEvent(date, booking);
      try { await sendEventEmail(booking); } catch (e) { console.warn('Email send failed:', e); }
      setSubmitting(false);
      setSubmitted(true);
    } catch (err) {
      setSubmitting(false);
      if (err.message === 'DATE_TAKEN') {
        setError('That date was just booked. Please pick another.');
      } else {
        setError('Something went wrong. Please try again.');
        console.error(err);
      }
    }
  };

  if (submitted) {
    return (
      <div style={{ background: '#FAF1E4', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
        <div style={{ textAlign: 'center', maxWidth: '500px' }}>
          <div style={{ display: 'inline-flex', width: '80px', height: '80px', borderRadius: '50%', background: '#E8A4B8', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
            <Sparkles size={36} color="#FFFEFA" />
          </div>
          <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(56px, 7vw, 80px)', color: '#2A1810', margin: '0 0 16px 0', fontWeight: 400, lineHeight: 1 }}>
            inquiry sent
          </h1>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '20px', color: '#5C3A21', marginBottom: '32px' }}>
            We'll be in touch within 24 hours to make your event unforgettable.
          </p>
          <button onClick={() => { setSubmitted(false); setDate(''); setTime(''); setGuests(''); setInfo({ name: '', email: '', phone: '', notes: '' }); }}
            style={{ background: '#2A1810', color: '#FAF1E4', padding: '14px 32px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 500, cursor: 'pointer' }}>
            New Inquiry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#FAF1E4', minHeight: '100vh' }}>
      <section style={{ padding: '60px 20px 48px 20px', textAlign: 'center', background: 'radial-gradient(ellipse at center, rgba(232, 164, 184, 0.12), transparent 70%)' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#5C3A21' }}>Events & Catering</span>
          <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(48px, 12vw, 112px)', color: '#2A1810', margin: '10px 0 0 0', fontWeight: 400, lineHeight: 0.95 }}>
            Bring us to your<br />special day
          </h1>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: 'clamp(16px, 4vw, 22px)', color: '#5C3A21', maxWidth: '580px', margin: '24px auto 0 auto', lineHeight: 1.6 }}>
            Custom drink bars, monogrammed cups, and that signature soft top — for the moments that matter most.
          </p>
        </div>
      </section>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 20px 60px 20px' }}>
        <div className="grid-2-sm" style={{ marginBottom: '32px' }}>
          {eventTypes.map(et => {
            const Icon = et.icon;
            const selected = eventType === et.id;
            return (
              <button key={et.id} onClick={() => setEventType(et.id)}
                style={{ background: selected ? '#2A1810' : '#FFFEFA', color: selected ? '#FAF1E4' : '#2A1810', border: `1.5px solid ${selected ? '#2A1810' : 'rgba(92, 58, 33, 0.12)'}`, borderRadius: '4px', padding: '18px', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: '14px', alignItems: 'flex-start', transition: 'all 0.3s' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: selected ? '#E8A4B8' : '#F0E2C9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={18} color={selected ? '#FFFEFA' : '#2A1810'} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px', gap: '8px', flexWrap: 'wrap' }}>
                    <h3 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '19px', margin: 0, fontWeight: 500, fontStyle: 'italic' }}>{et.label}</h3>
                    <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', opacity: 0.8, whiteSpace: 'nowrap' }}>from ${et.from}</span>
                  </div>
                  <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', margin: 0, lineHeight: 1.5, opacity: 0.85 }}>{et.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ background: '#FFFEFA', padding: '24px 20px', borderRadius: '4px', border: '1px solid rgba(92, 58, 33, 0.1)' }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: '0 0 20px 0', fontWeight: 500 }}>Tell us about your event</h2>

          <div className="grid-2-form" style={{ marginBottom: '16px' }}>
            <CheckoutInput label="Event Date *" value={date} onChange={setDate} type="date" />
            <CheckoutInput label="Start Time *" value={time} onChange={setTime} type="time" />
            <CheckoutInput label="Duration (hours)" value={duration} onChange={setDuration} placeholder="2" />
            <CheckoutInput label="Estimated Guests" value={guests} onChange={setGuests} placeholder="50" />
          </div>

          {date && bookedDates[date] && (
            <div style={{ background: 'rgba(232, 85, 122, 0.1)', border: '1px solid rgba(232, 85, 122, 0.3)', padding: '12px', borderRadius: '4px', marginBottom: '16px', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '14px', color: '#A83A56' }}>
              That date is already booked. Please choose another.
            </div>
          )}

          <div className="grid-2-form" style={{ marginBottom: '16px' }}>
            <CheckoutInput label="Your Name *" value={info.name} onChange={(v) => setInfo({ ...info, name: v })} />
            <CheckoutInput label="Phone *" value={info.phone} onChange={(v) => setInfo({ ...info, phone: v })} />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <CheckoutInput label="Email *" value={info.email} onChange={(v) => setInfo({ ...info, email: v })} type="email" />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '6px' }}>Event Details</label>
            <textarea value={info.notes} onChange={(e) => setInfo({ ...info, notes: e.target.value })}
              placeholder="Tell us about your vision — themes, custom flavors, monogram requests, anything we should know..." rows={4}
              style={{ width: '100%', padding: '12px 14px', borderRadius: '4px', border: '1.5px solid rgba(92, 58, 33, 0.2)', background: '#FAF1E4', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#2A1810', outline: 'none', resize: 'vertical' }} />
          </div>

          {error && (
            <div style={{ background: 'rgba(232, 85, 122, 0.1)', border: '1px solid rgba(232, 85, 122, 0.3)', padding: '12px', borderRadius: '4px', marginBottom: '16px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#A83A56' }}>
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={submitting}
            style={{ width: '100%', background: submitting ? '#5C3A21' : '#2A1810', color: '#FAF1E4', padding: '16px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500, cursor: submitting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            {submitting ? <><Loader2 size={16} className="spin" /> Sending...</> : <>Submit Inquiry <Sparkles size={14} /></>}
          </button>
        </div>

        <div className="grid-3-md" style={{ marginTop: '48px' }}>
          {[
            { title: 'Custom Drink Menu', desc: 'We curate a signature menu around your theme, dietary needs, and color palette.' },
            { title: 'Monogrammed Cups', desc: 'Your initials, names, or hashtag printed on each soft-top cup. A keepsake guests adore.' },
            { title: 'On-Site Service', desc: 'Two artisans, all equipment, setup, and cleanup. You don\'t lift a finger.' },
          ].map(f => (
            <div key={f.title}>
              <h4 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '20px', color: '#2A1810', margin: '0 0 8px 0', fontWeight: 500, fontStyle: 'italic' }}>{f.title}</h4>
              <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#5C3A21', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// FOOTER
// ═══════════════════════════════════════════════════════
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
            {[{ id: 'home', label: 'Home' }, { id: 'order', label: 'Order Online' }, { id: 'events', label: 'Events' }].map(l => (
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
  const [page, setPage] = useState('home');
  const [cart, setCart] = useState([]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [page]);

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <div style={{ background: '#FAF1E4', minHeight: '100vh' }}>
      <Nav page={page} setPage={setPage} cartCount={cartCount} />
      <div className="fade-in" key={page}>
        {page === 'home' && <HomePage setPage={setPage} />}
        {page === 'order' && <OrderPage cart={cart} setCart={setCart} />}
        {page === 'events' && <EventsPage />}
      </div>
      <Footer setPage={setPage} />
    </div>
  );
}
