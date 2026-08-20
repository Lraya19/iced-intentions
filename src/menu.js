// ═══════════════════════════════════════════════════════════════
// Iced Intentions — menu, pricing and date helpers
// ───────────────────────────────────────────────────────────────
// Shared by the customer site, the staff POS and the kiosk, so it lives
// apart from App.jsx rather than being imported across page modules.
//
// ⚠️  PRICES AND TAX ARE MIRRORED in supabase/functions/process-payment.
//     That copy is the authoritative one — everything here is for display.
//     Change one and you must change the other, or the server will refuse
//     the cart as unpriceable.
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════
// MENU
// ═══════════════════════════════════════════════════════
const MENU = {
  matcha: {
    title: 'Matcha',
    note: 'All matchas made with oatmilk — except Verdí',
    items: [
      { id: 'matcha-verdi', photo: '/drinks/matcha-verdi.jpeg', name: 'Matcha Verdí', desc: 'Pure ceremonial-grade matcha with a kiss of vanilla', priceL: 10.50, priceBucket: 19.00, gradient: 'linear-gradient(180deg, #F5F0DC 0%, #B5C99A 50%, #6B8E4E 100%)' },
      { id: 'matcha-besitos', photo: '/drinks/matcha-besitos.jpeg', name: 'Matcha Besitos', desc: 'Cookie butter matcha with a Biscoff crumble & soft top', priceL: 10.50, priceBucket: 19.00, gradient: 'linear-gradient(180deg, #E8C896 0%, #B5C99A 40%, #6B8E4E 100%)' },
      { id: 'matcha-blanqui', photo: '/drinks/matcha-blanqui-v2.jpeg', name: 'Matcha Blanquí', desc: 'Banana matcha — smooth, creamy & lightly sweet', priceL: 10.50, priceBucket: 19.00, gradient: 'linear-gradient(180deg, #FFF8E7 0%, #D4DEAB 50%, #8FA968 100%)' },
      { id: 'matcha-rosa', photo: '/drinks/matcha-rosa.jpeg', name: 'Matcha Rosa', desc: 'Strawberry matcha — jade matcha over sweet strawberry', priceL: 10.50, priceBucket: 19.00, gradient: 'linear-gradient(180deg, #B5C99A 0%, #B5C99A 45%, #FFE4D6 60%, #C8345A 100%)' },
    ],
  },
  lattes: {
    title: 'Lattes',
    items: [
      { id: 'dulce-moonkiss', photo: '/drinks/dulce-moon-kiss-v2.jpeg', name: 'Dulce Moon-Kiss', desc: 'Chocolate banana, topped with imported cinnamon from El Salvador', priceL: 8.00, priceBucket: 15.00, gradient: 'linear-gradient(180deg, #F5E6D3 0%, #C8A57A 50%, #6B4423 100%)' },
      { id: 'mornenita-mornings', photo: '/drinks/mornenita-mornings-v2.jpeg', name: 'Mornenita Mornings', desc: 'Cinnamon churro flavor with cinnamon-dusted foam', priceL: 8.00, priceBucket: 15.00, gradient: 'linear-gradient(180deg, #FFF1DC 0%, #E8A85C 40%, #8B5E2C 100%)' },
      { id: 'nube-blush', photo: '/drinks/nube-blush-v2.jpeg', name: 'Nube Blush', desc: 'Vanilla caramel with a silky vanilla foam', priceL: 8.00, priceBucket: 15.00, gradient: 'linear-gradient(180deg, #FFE4E1 0%, #E8A4B8 50%, #C18298 100%)' },
      { id: 'besitos-brunette', photo: '/drinks/besitos-brunette-v2.jpeg', name: 'Besitos Brunette', desc: 'Cookie butter latte with cookie butter cold foam', priceL: 8.00, priceBucket: 15.00, gradient: 'linear-gradient(180deg, #D4A574 0%, #8B5E2C 50%, #4A2C17 100%)' },
    ],
  },
  refreshers: {
    title: 'Refreshers',
    sizeNote: '32 oz',
    items: [
      { id: 'sweet-cielo', photo: '/drinks/sweet-cielo-v2.jpeg', name: 'Sweet Cielo', desc: 'Blue raspberry refresher', priceL: 8.00, priceBucket: 8.00, singleSize: true, gradient: 'linear-gradient(180deg, #CDEBFF 0%, #6FB7E8 50%, #2E7FC2 100%)' },
      { id: 'sunkissed-cielo', photo: '/drinks/sunkissed-cielo-v2.jpeg', name: 'SunKissed Cielo', desc: 'Mango dragonfruit refresher', priceL: 8.00, priceBucket: 8.00, singleSize: true, gradient: 'linear-gradient(180deg, #FFD8A8 0%, #E86A9E 55%, #9C2B8A 100%)' },
      { id: 'coquetta-crush', photo: '/drinks/coquetta-crush-v2.jpeg', name: 'Coquetta Crush', desc: 'Strawberry refresher', priceL: 8.00, priceBucket: 8.00, singleSize: true, gradient: 'linear-gradient(180deg, #FFF0F0 0%, #FFB8C8 50%, #E8557A 100%)' },
      { id: 'summer-chula', photo: '/drinks/summer-chula.jpeg', name: 'Summer Chula', desc: 'Mango with a chamoy rim', priceL: 8.00, priceBucket: 8.00, singleSize: true, gradient: 'linear-gradient(180deg, #FFC98A 0%, #F0803C 45%, #B5322E 100%)' },
    ],
  },
  energy: {
    title: 'Energy Drinks',
    note: 'All energy drinks are RedBull-based',
    items: [
      { id: 'paraiso-fuse', photo: '/drinks/paraiso-fuse.jpeg', name: 'Paraíso Fuse', desc: 'Tropical RedBull refresher', priceL: 8.00, priceBucket: 12.00, gradient: 'linear-gradient(180deg, #FFEBC4 0%, #FFD17A 50%, #FFA630 100%)' },
      { id: 'cremita-fuse', photo: '/drinks/cremita-fuse.jpeg', name: 'Cremita Fuse', desc: 'Piña colada RedBull refresher', priceL: 8.00, priceBucket: 12.00, gradient: 'linear-gradient(180deg, #FFF5E1 0%, #F5DDB3 50%, #C9A86A 100%)' },
      { id: 'azulita-fuse', photo: '/drinks/azulita-fuse.jpeg', name: 'Azulita Fuse', desc: 'Blue raspberry RedBull refresher', priceL: 8.00, priceBucket: 12.00, gradient: 'linear-gradient(180deg, #B8F0E8 0%, #5DD4C5 50%, #2BA89A 100%)' },
      { id: 'verde-fuse', photo: '/drinks/verde-fuse.jpeg', name: 'Verde Fuse', desc: 'Green apple RedBull refresher', priceL: 8.00, priceBucket: 12.00, gradient: 'linear-gradient(180deg, #DEF5C9 0%, #95D478 50%, #4A9B2D 100%)' },
    ],
  },
};

const ADD_ONS = [
  { id: 'oatmilk', name: 'Oatmilk', price: 0.75 },
  { id: 'extra-shot', name: 'Extra Shot', price: 0.75 },
  { id: 'chamoy', name: 'Chamoy', price: 0.75 },
  { id: 'extra-matcha', name: 'Extra Matcha', price: 1.00 },
];

const SIZES = [
  { id: 'L', label: 'Large (24 oz)' },
  { id: 'BUCKET', label: 'Bucket (32 oz)' },
];

// Sales tax — Bakersfield, CA (7.25% state + 1.00% district).
// Applied to the POST-discount amount: a loyalty reward is a
// retailer-funded discount, so it reduces taxable gross receipts.
// These figures are for DISPLAY ONLY — process-payment recomputes the
// authoritative tax and total server-side. Must match TAX_RATE there.
const TAX_RATE = 0.0825;
const round2 = (n) => Math.round(n * 100) / 100;

// Look up a drink by id + a friendly size label (single-size drinks show "32 oz").
const DRINK_BY_ID = {};
Object.values(MENU).forEach(c => c.items.forEach(d => { DRINK_BY_ID[d.id] = d; }));
const sizeLabel = (drinkId, size) => {
  const d = DRINK_BY_ID[drinkId];
  if (d && d.singleSize) return '32 oz';
  return size === 'L' ? 'Large' : 'Bucket';
};


// Returns YYYY-MM-DD in LOCAL time (not UTC).
// Using toISOString() would shift the date in evening hours for non-UTC zones.
const formatLocalDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};


const toDisplayTime = (h, m) => `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;

// Parse a YYYY-MM-DD string into a LOCAL Date (no timezone shift).
const parseLocalDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};


export { MENU, ADD_ONS, SIZES, DRINK_BY_ID, sizeLabel, TAX_RATE, round2, formatLocalDate, toDisplayTime, parseLocalDate };
