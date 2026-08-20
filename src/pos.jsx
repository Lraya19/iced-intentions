// ═══════════════════════════════════════════════════════════════
// Iced Intentions — POS & Kiosk
// ───────────────────────────────────────────────────────────────
// Our own till software. Square is invisible plumbing underneath: it
// never appears in the UI, and for cash it isn't involved at all.
//
// Both screens build an order locally, save it as a PENDING row, then
// settle it one of two ways:
//
//   cash → pos_settle_cash() marks it paid and records who rang it and
//          how much was handed over. No processor, no fee.
//   card → the customer pays on their own phone via a QR, or on the
//          screen in front of them. Either way process-payment prices the
//          order from the saved row, so the till's numbers are display
//          only and can't be tampered into a cheaper charge.
//
// Lazy-loaded from App.jsx — customers never download any of this.
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X, Plus, Minus, Loader2, Check, Coffee, Banknote, CreditCard,
  ChevronLeft, ShoppingBag, RotateCcw, Gift, ArrowLeft,
} from 'lucide-react';
import { InfinityHeart, QrCode } from './ui';
import { MENU, ADD_ONS, addOnsFor, sizeLabel, TAX_RATE, round2, formatLocalDate } from './menu';
import { saveOrder } from './storage';
import { settleCash, getOrderPaymentStatus } from './admin';

// ── Shared ticket maths ────────────────────────────────────────
const lineTotal = (l) => {
  const addOnSum = (l.addOns || []).reduce(
    (s, id) => s + (ADD_ONS.find(a => a.id === id)?.price || 0), 0,
  );
  return round2((l.basePrice + addOnSum) * l.qty);
};

const ticketTotals = (lines) => {
  const subtotal = round2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const tax = round2(subtotal * TAX_RATE);
  return { subtotal, tax, total: round2(subtotal + tax) };
};

const makeLine = (drink, size) => ({
  key: `${drink.id}-${size}-${Math.random().toString(36).slice(2, 8)}`,
  drinkId: drink.id,
  name: drink.name,
  size,
  sizeDisplay: sizeLabel(drink.id, size),
  photo: drink.photo || null,
  addOns: [],
  qty: 1,
  basePrice: size === 'L' ? drink.priceL : drink.priceBucket,
});

const toItems = (lines) => lines.map(l => ({
  drinkId: l.drinkId, name: l.name, size: l.size, sizeDisplay: l.sizeDisplay,
  addOns: l.addOns, qty: l.qty, basePrice: l.basePrice, lineTotal: lineTotal(l),
}));

// A random id: it travels in a URL the customer may scan, and a guessable
// one would let a stranger pay — or claim the stamp on — someone else's tab.
const newOrderId = (prefix) =>
  `${prefix}_${(crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/-/g, '')}`;

// Persist a built ticket as a pending order, ready to be settled.
async function createPendingOrder(lines, { orderType, customerName }) {
  const { subtotal, tax, total } = ticketTotals(lines);
  const id = newOrderId(orderType === 'kiosk' ? 'kio' : 'pos');
  await saveOrder(id, {
    id,
    orderType,
    userId: null, // claimed by whoever pays or scans for the stamp
    pickupDate: formatLocalDate(new Date()),
    pickupTime: null,
    pickupTimeDisplay: orderType === 'kiosk' ? 'Kiosk' : 'Counter',
    customer: { name: customerName || (orderType === 'kiosk' ? 'Kiosk' : 'Counter'), phone: '', email: '' },
    items: toItems(lines),
    subtotal, discount: 0, tax, total,
    paymentStatus: 'pending',
  });
  return { id, subtotal, tax, total };
}

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

// ═══════════════════════════════════════════════════════════════
// SHARED: the drink pad
// ═══════════════════════════════════════════════════════════════
const DrinkPad = ({ onAdd, large = false }) => {
  const [cat, setCat] = useState(Object.keys(MENU)[0]);
  const items = MENU[cat].items;

  return (
    <div>
      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {Object.entries(MENU).map(([key, c]) => (
          <button key={key} onClick={() => setCat(key)}
            style={{ padding: large ? '12px 22px' : '9px 16px', borderRadius: '999px', border: `1.5px solid ${cat === key ? '#2A1810' : 'rgba(92,58,33,0.22)'}`, background: cat === key ? '#2A1810' : 'transparent', color: cat === key ? '#FAF1E4' : '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: large ? '14px' : '11px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer' }}>
            {c.title}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${large ? 210 : 165}px, 1fr))`, gap: '9px' }}>
        {items.map(d => {
          const sizes = d.singleSize
            ? [['BUCKET', '32 oz', d.priceBucket]]
            : [['L', 'Large', d.priceL], ['BUCKET', 'Bucket', d.priceBucket]];
          return (
            <div key={d.id} style={{ border: '1.5px solid rgba(92,58,33,0.15)', borderRadius: '12px', background: '#FFFEFA', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {large && d.photo && (
                <div style={{ width: '100%', aspectRatio: '4/3', overflow: 'hidden', background: '#EDE4D3' }}>
                  <img src={d.photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              )}
              <div style={{ padding: large ? '12px' : '10px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: large ? '19px' : '15px', fontStyle: 'italic', fontWeight: 600, color: '#2A1810', marginBottom: '8px', lineHeight: 1.15 }}>
                  {d.name}
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
                  {sizes.map(([sz, lbl, pr]) => (
                    <button key={sz} onClick={() => onAdd(d, sz)}
                      style={{ flex: 1, padding: large ? '14px 6px' : '9px 5px', borderRadius: '8px', border: 'none', background: '#2A1810', color: '#FAF1E4', fontFamily: '"Outfit", sans-serif', fontSize: large ? '13px' : '11px', fontWeight: 600, cursor: 'pointer', lineHeight: 1.3 }}>
                      {lbl}<br /><span style={{ opacity: 0.85, fontSize: large ? '12px' : '10px' }}>{money(pr)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// SHARED: the ticket
// ═══════════════════════════════════════════════════════════════
const Ticket = ({ lines, setLines, compact = false }) => {
  const patch = (key, p) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...p } : l));
  const remove = (key) => setLines(ls => ls.filter(l => l.key !== key));

  if (lines.length === 0) {
    return (
      <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '16px', color: '#5C3A21', textAlign: 'center', padding: '30px 12px', margin: 0 }}>
        Nothing on this ticket yet.
      </p>
    );
  }

  return (
    <div>
      {lines.map(l => (
        <div key={l.key} style={{ borderBottom: '1px solid rgba(92,58,33,0.1)', padding: '10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '17px', fontStyle: 'italic', fontWeight: 600, color: '#2A1810', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.name} <span style={{ fontSize: '12px', opacity: 0.65 }}>({l.sizeDisplay})</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
              <button onClick={() => patch(l.key, { qty: Math.max(1, l.qty - 1) })} aria-label="Less"
                style={{ width: '30px', height: '30px', borderRadius: '50%', border: '1.5px solid rgba(92,58,33,0.25)', background: '#FFFEFA', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Minus size={13} color="#2A1810" />
              </button>
              <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', fontWeight: 600, minWidth: '22px', textAlign: 'center' }}>{l.qty}</span>
              <button onClick={() => patch(l.key, { qty: l.qty + 1 })} aria-label="More"
                style={{ width: '30px', height: '30px', borderRadius: '50%', border: '1.5px solid rgba(92,58,33,0.25)', background: '#FFFEFA', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Plus size={13} color="#2A1810" />
              </button>
              <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '17px', fontWeight: 600, minWidth: '58px', textAlign: 'right' }}>{money(lineTotal(l))}</span>
              <button onClick={() => remove(l.key)} aria-label="Remove"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A83A56', padding: '3px' }}>
                <X size={16} />
              </button>
            </span>
          </div>
          {!compact && addOnsFor(l.drinkId).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '7px' }}>
              {addOnsFor(l.drinkId).map(a => {
                const on = l.addOns.includes(a.id);
                return (
                  <button key={a.id}
                    onClick={() => patch(l.key, { addOns: on ? l.addOns.filter(x => x !== a.id) : [...l.addOns, a.id] })}
                    style={{ padding: '5px 10px', borderRadius: '999px', border: `1px solid ${on ? '#E8A4B8' : 'rgba(92,58,33,0.2)'}`, background: on ? '#E8A4B8' : 'transparent', color: '#2A1810', fontFamily: '"Outfit", sans-serif', fontSize: '10.5px', cursor: 'pointer' }}>
                    {on && '✓ '}{a.name} +{money(a.price)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const Totals = ({ subtotal, tax, total }) => (
  <div style={{ marginTop: '12px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', marginBottom: '4px' }}>
      <span>Subtotal</span><span>{money(subtotal)}</span>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', marginBottom: '10px' }}>
      <span>Sales tax</span><span>{money(tax)}</span>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid rgba(92,58,33,0.2)', paddingTop: '10px' }}>
      <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#5C3A21' }}>Total</span>
      <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '30px', fontWeight: 600, color: '#2A1810' }}>{money(total)}</span>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// STAFF POS
// ═══════════════════════════════════════════════════════════════
export const PosPage = ({ role, onExit }) => {
  const [lines, setLines] = useState([]);
  const [stage, setStage] = useState('build'); // build | cash | card | done
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cashInput, setCashInput] = useState('');
  const [result, setResult] = useState(null); // { id, total, changeDue, method }
  const [cardOrder, setCardOrder] = useState(null); // { id, url, total }
  const [cardPaid, setCardPaid] = useState(false);

  const { subtotal, tax, total } = useMemo(() => ticketTotals(lines), [lines]);
  const addLine = (d, sz) => setLines(ls => [...ls, makeLine(d, sz)]);
  const reset = () => {
    setLines([]); setStage('build'); setError(''); setCashInput('');
    setResult(null); setCardOrder(null); setCardPaid(false);
  };

  // ── Cash ──
  const takeCash = async (received) => {
    setBusy(true); setError('');
    try {
      const { id } = await createPendingOrder(lines, { orderType: 'pos', customerName: 'Counter' });
      const settled = await settleCash(id, received ?? null);
      setResult({
        id,
        total: Number(settled?.total ?? total),
        changeDue: settled?.change_due == null ? null : Number(settled.change_due),
        method: 'cash',
      });
      setStage('done');
    } catch (err) {
      setError(err.message || 'Could not take that payment.');
    } finally {
      setBusy(false);
    }
  };

  // ── Card ──
  const startCard = async () => {
    setBusy(true); setError('');
    try {
      const { id, total: t } = await createPendingOrder(lines, { orderType: 'pos', customerName: 'Counter' });
      setCardOrder({ id, url: `${window.location.origin}/?pay=${id}`, total: t });
      setStage('card');
    } catch (err) {
      setError(err.message || 'Could not start that payment.');
    } finally {
      setBusy(false);
    }
  };

  // Watch for the customer finishing on their phone, so staff don't have to
  // ask "did it go through?" — the till just flips to paid.
  useEffect(() => {
    if (stage !== 'card' || !cardOrder || cardPaid) return;
    let alive = true;
    const t = setInterval(async () => {
      const status = await getOrderPaymentStatus(cardOrder.id);
      if (alive && status === 'paid') {
        setCardPaid(true);
        setResult({ id: cardOrder.id, total: cardOrder.total, changeDue: null, method: 'card' });
      }
    }, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [stage, cardOrder, cardPaid]);

  const quickCash = useMemo(() => {
    const opts = new Set([Math.ceil(total)]);
    [5, 10, 20, 50].forEach(v => { if (v >= total) opts.add(v); });
    return [...opts].sort((a, b) => a - b).slice(0, 4);
  }, [total]);

  const Frame = ({ children }) => (
    <div style={{ background: '#FAF1E4', minHeight: '100vh', padding: '16px' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <InfinityHeart size={26} color="#2A1810" />
            <span style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '26px', color: '#2A1810', lineHeight: 1 }}>Iced Intentions</span>
            <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21', border: '1px solid rgba(92,58,33,0.25)', borderRadius: '999px', padding: '3px 9px' }}>
              Till · {role === 'owner' ? 'Owner' : 'Staff'}
            </span>
          </span>
          <button onClick={onExit}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', border: '1.5px solid rgba(92,58,33,0.25)', borderRadius: '999px', padding: '8px 15px', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5C3A21', cursor: 'pointer' }}>
            <ArrowLeft size={13} /> Exit
          </button>
        </div>
        {children}
      </div>
    </div>
  );

  // ── Completed sale ──
  if (stage === 'done' || cardPaid) {
    const r = result || {};
    return (
      <Frame>
        <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.12)', borderRadius: '18px', padding: '34px 24px', textAlign: 'center', maxWidth: '520px', margin: '30px auto' }}>
          <div style={{ display: 'inline-flex', width: '68px', height: '68px', borderRadius: '50%', background: '#3D7A4F', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
            <Check size={32} color="#FFFEFA" />
          </div>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '28px', color: '#2A1810', margin: '0 0 4px 0', fontWeight: 600 }}>
            Paid {money(r.total)}
          </h2>
          <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#5C3A21', margin: '0 0 18px 0' }}>
            {r.method === 'cash' ? 'Cash' : 'Card'}
          </p>

          {r.changeDue != null && r.changeDue > 0 && (
            <div style={{ background: '#F0E2C9', borderRadius: '14px', padding: '18px', marginBottom: '18px' }}>
              <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Change due</div>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '52px', fontWeight: 600, color: '#2A1810', lineHeight: 1.1 }}>
                {money(r.changeDue)}
              </div>
            </div>
          )}

          {/* Cash sales have no account attached, so the stamp would be lost
              unless the customer scans to claim it. */}
          {r.id && (
            <div style={{ borderTop: '1px solid rgba(92,58,33,0.12)', paddingTop: '18px', marginBottom: '18px' }}>
              <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#5C3A21', margin: '0 0 12px 0' }}>
                <Gift size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Want their stamp? Have them scan this.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <QrCode value={`${window.location.origin}/?claim=${r.id}`} size={150} />
              </div>
            </div>
          )}

          <button onClick={reset}
            style={{ width: '100%', background: '#2A1810', color: '#FAF1E4', padding: '17px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer' }}>
            New sale
          </button>
        </div>
      </Frame>
    );
  }

  // ── Card: customer scans and pays on their phone ──
  if (stage === 'card' && cardOrder) {
    return (
      <Frame>
        <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.12)', borderRadius: '18px', padding: '30px 24px', textAlign: 'center', maxWidth: '520px', margin: '20px auto' }}>
          <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '26px', color: '#2A1810', margin: '0 0 4px 0', fontWeight: 600 }}>
            {money(cardOrder.total)} — have them scan
          </h2>
          <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '15px', color: '#5C3A21', margin: '0 0 18px 0' }}>
            They'll pay on their phone and earn a stamp. This screen updates itself.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <QrCode value={cardOrder.url} size={230} />
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#5C3A21', marginBottom: '18px' }}>
            <Loader2 size={13} className="spin" /> Waiting for payment…
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => { setStage('build'); setCardOrder(null); }}
              style={{ flex: 1, background: 'transparent', border: '1.5px solid rgba(92,58,33,0.25)', color: '#5C3A21', padding: '14px', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer' }}>
              Back to ticket
            </button>
            <button onClick={() => setStage('cash')}
              style={{ flex: 1, background: '#2A1810', color: '#FAF1E4', border: 'none', padding: '14px', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer' }}>
              Take cash instead
            </button>
          </div>
        </div>
      </Frame>
    );
  }

  // ── Cash tender ──
  if (stage === 'cash') {
    const received = parseFloat(cashInput);
    const valid = Number.isFinite(received) && received >= total;
    return (
      <Frame>
        <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.12)', borderRadius: '18px', padding: '28px 24px', maxWidth: '520px', margin: '20px auto' }}>
          <button onClick={() => setStage('build')}
            style={{ background: 'none', border: 'none', color: '#5C3A21', fontFamily: '"Outfit", sans-serif', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', padding: 0 }}>
            <ChevronLeft size={15} /> Back to ticket
          </button>
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5C3A21' }}>Amount due</div>
            <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '52px', fontWeight: 600, color: '#2A1810', lineHeight: 1.1 }}>{money(total)}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: '8px', marginBottom: '14px' }}>
            {quickCash.map(v => (
              <button key={v} onClick={() => takeCash(v)} disabled={busy}
                style={{ padding: '18px 8px', borderRadius: '12px', border: '1.5px solid rgba(92,58,33,0.2)', background: '#FAF1E4', color: '#2A1810', fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
                {money(v)}
              </button>
            ))}
          </div>

          <label style={{ fontFamily: '"Outfit", sans-serif', fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#5C3A21', display: 'block', marginBottom: '6px' }}>
            Or enter what they handed over
          </label>
          <input value={cashInput} onChange={e => setCashInput(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal" placeholder={total.toFixed(2)}
            style={{ width: '100%', padding: '14px', borderRadius: '10px', border: '1.5px solid rgba(92,58,33,0.25)', background: '#FAF1E4', fontFamily: '"Cormorant Garamond", serif', fontSize: '26px', fontWeight: 600, color: '#2A1810', textAlign: 'center', outline: 'none', boxSizing: 'border-box', marginBottom: '10px' }} />

          {cashInput && !valid && (
            <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#A83A56', margin: '0 0 10px 0', textAlign: 'center' }}>
              That's less than the total.
            </p>
          )}
          {cashInput && valid && (
            <p style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '18px', color: '#2A1810', margin: '0 0 10px 0', textAlign: 'center' }}>
              Change due <strong>{money(round2(received - total))}</strong>
            </p>
          )}
          {error && (
            <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#A83A56', marginBottom: '10px', textAlign: 'center' }}>{error}</p>
          )}

          <button onClick={() => takeCash(valid ? received : total)} disabled={busy || (cashInput && !valid)}
            style={{ width: '100%', background: '#2A1810', color: '#FAF1E4', padding: '18px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', opacity: (cashInput && !valid) ? 0.5 : 1 }}>
            {busy ? <><Loader2 size={16} className="spin" /> Recording…</> : <><Banknote size={16} /> Take cash</>}
          </button>
        </div>
      </Frame>
    );
  }

  // ── Build the ticket ──
  return (
    <Frame>
      <div className="pos-grid">
        <div>
          <DrinkPad onAdd={addLine} />
        </div>

        <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.12)', borderRadius: '16px', padding: '16px', alignSelf: 'start', position: 'sticky', top: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '22px', color: '#2A1810', margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShoppingBag size={17} /> Ticket
            </h2>
            {lines.length > 0 && (
              <button onClick={() => setLines([])}
                style={{ background: 'none', border: 'none', color: '#A83A56', fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <RotateCcw size={12} /> Clear
              </button>
            )}
          </div>

          <Ticket lines={lines} setLines={setLines} />

          {lines.length > 0 && (
            <>
              <Totals subtotal={subtotal} tax={tax} total={total} />
              {error && (
                <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#A83A56', marginTop: '10px' }}>{error}</p>
              )}
              <div style={{ display: 'grid', gap: '8px', marginTop: '14px' }}>
                <button onClick={startCard} disabled={busy}
                  style={{ background: '#2A1810', color: '#FAF1E4', padding: '18px', border: 'none', borderRadius: '12px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  {busy ? <Loader2 size={16} className="spin" /> : <CreditCard size={16} />} Card
                </button>
                <button onClick={() => { setError(''); setStage('cash'); }} disabled={busy}
                  style={{ background: '#F0E2C9', color: '#2A1810', padding: '18px', border: '1.5px solid rgba(92,58,33,0.2)', borderRadius: '12px', fontFamily: '"Outfit", sans-serif', fontSize: '13px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  <Banknote size={16} /> Cash
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Frame>
  );
};

// ═══════════════════════════════════════════════════════════════
// SELF-SERVE KIOSK
// ───────────────────────────────────────────────────────────────
// Runs unattended on a tablet, so it never exposes staff screens and
// always returns itself to the attract screen when a sale finishes.
// ═══════════════════════════════════════════════════════════════
export const KioskPage = ({ onPayOnScreen }) => {
  const [stage, setStage] = useState('attract'); // attract | order | pay
  const [lines, setLines] = useState([]);
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paid, setPaid] = useState(false);

  const { subtotal, tax, total } = useMemo(() => ticketTotals(lines), [lines]);
  const reset = () => { setLines([]); setOrder(null); setPaid(false); setError(''); setStage('attract'); };

  // Poll so the kiosk clears itself once they've paid on their phone —
  // nobody wants to walk up to the last person's order still on screen.
  useEffect(() => {
    if (stage !== 'pay' || !order || paid) return;
    let alive = true;
    const t = setInterval(async () => {
      const status = await getOrderPaymentStatus(order.id);
      if (alive && status === 'paid') setPaid(true);
    }, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [stage, order, paid]);

  // Auto-return to the attract screen after a completed sale.
  useEffect(() => {
    if (!paid) return;
    const t = setTimeout(reset, 12000);
    return () => clearTimeout(t);
  }, [paid]);

  const startPay = async () => {
    setBusy(true); setError('');
    try {
      const { id, total: t } = await createPendingOrder(lines, { orderType: 'kiosk', customerName: 'Kiosk' });
      setOrder({ id, url: `${window.location.origin}/?pay=${id}`, total: t });
      setStage('pay');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please ask a member of staff.');
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'attract') {
    return (
      <button onClick={() => setStage('order')}
        style={{ width: '100%', minHeight: '100vh', border: 'none', cursor: 'pointer', background: 'radial-gradient(ellipse at top right, rgba(232,164,184,0.18), transparent 60%), radial-gradient(ellipse at bottom left, rgba(181,201,154,0.14), transparent 60%), #FAF1E4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '40px' }}>
        <InfinityHeart size={78} color="#2A1810" />
        <span style={{ fontFamily: '"Pinyon Script", cursive', fontSize: 'clamp(56px, 12vw, 110px)', color: '#2A1810', lineHeight: 1 }}>
          Iced Intentions
        </span>
        <span style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: 'clamp(20px, 3.4vw, 30px)', color: '#5C3A21', marginTop: '6px' }}>
          Tap anywhere to order
        </span>
        <span style={{ marginTop: '26px', background: '#2A1810', color: '#FAF1E4', borderRadius: '999px', padding: '18px 44px', fontFamily: '"Outfit", sans-serif', fontSize: '15px', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 600 }}>
          Start order
        </span>
      </button>
    );
  }

  if (stage === 'pay' && order) {
    return (
      <div style={{ background: '#FAF1E4', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px' }}>
        <div style={{ maxWidth: '540px', width: '100%', textAlign: 'center' }}>
          {paid ? (
            <>
              <div style={{ display: 'inline-flex', width: '92px', height: '92px', borderRadius: '50%', background: '#3D7A4F', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
                <Check size={44} color="#FFFEFA" />
              </div>
              <h1 style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '68px', color: '#2A1810', margin: '0 0 8px 0', fontWeight: 400, lineHeight: 1 }}>thank you</h1>
              <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '22px', color: '#5C3A21', margin: 0 }}>
                We're making it now. ☕
              </p>
            </>
          ) : (
            <>
              <h1 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '34px', color: '#2A1810', margin: '0 0 4px 0', fontWeight: 600 }}>
                {money(order.total)}
              </h1>
              <p style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '19px', color: '#5C3A21', margin: '0 0 22px 0' }}>
                Scan with your phone to pay — and collect a stamp toward a free drink.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '22px' }}>
                <QrCode value={order.url} size={270} />
              </div>
              <button onClick={() => onPayOnScreen(order.id)}
                style={{ width: '100%', background: '#2A1810', color: '#FAF1E4', padding: '19px', border: 'none', borderRadius: '999px', fontFamily: '"Outfit", sans-serif', fontSize: '14px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer', marginBottom: '10px' }}>
                No phone? Pay on this screen
              </button>
              <button onClick={reset}
                style={{ background: 'none', border: 'none', color: '#5C3A21', fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: '17px', cursor: 'pointer', textDecoration: 'underline' }}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#FAF1E4', minHeight: '100vh', padding: '18px' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <InfinityHeart size={30} color="#2A1810" />
            <span style={{ fontFamily: '"Pinyon Script", cursive', fontSize: '32px', color: '#2A1810', lineHeight: 1 }}>Iced Intentions</span>
          </span>
          <button onClick={reset}
            style={{ background: 'transparent', border: '1.5px solid rgba(92,58,33,0.25)', borderRadius: '999px', padding: '11px 20px', fontFamily: '"Outfit", sans-serif', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5C3A21', cursor: 'pointer' }}>
            Start over
          </button>
        </div>

        <div className="pos-grid">
          <div><DrinkPad onAdd={(d, sz) => setLines(ls => [...ls, makeLine(d, sz)])} large /></div>

          <div style={{ background: '#FFFEFA', border: '1px solid rgba(92,58,33,0.12)', borderRadius: '16px', padding: '18px', alignSelf: 'start', position: 'sticky', top: '18px' }}>
            <h2 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '24px', color: '#2A1810', margin: '0 0 6px 0', fontWeight: 600 }}>Your order</h2>
            <Ticket lines={lines} setLines={setLines} />
            {lines.length > 0 && (
              <>
                <Totals subtotal={subtotal} tax={tax} total={total} />
                {error && <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '13px', color: '#A83A56', marginTop: '10px' }}>{error}</p>}
                <button onClick={startPay} disabled={busy}
                  style={{ width: '100%', marginTop: '14px', background: '#2A1810', color: '#FAF1E4', padding: '20px', border: 'none', borderRadius: '12px', fontFamily: '"Outfit", sans-serif', fontSize: '14px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  {busy ? <><Loader2 size={17} className="spin" /> One moment…</> : <><Coffee size={17} /> Pay {money(total)}</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
