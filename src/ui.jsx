// ═══════════════════════════════════════════════════════════════
// Iced Intentions — shared UI atoms
// ───────────────────────────────────────────────────────────────
// Used by the customer site, the staff POS and the kiosk. Kept out of
// App.jsx so the POS bundle can import them without pulling in the whole
// storefront.
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

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


// ═══════════════════════════════════════════════════════
// QR CODE
// ───────────────────────────────────────────────────────
// The encoder is ~50KB and only the owner ever needs it, so it's loaded
// on demand rather than shipped to every customer.
// ═══════════════════════════════════════════════════════
const QrCode = ({ value, size = 220, label }) => {
  const [dataUrl, setDataUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setDataUrl(''); setFailed(false);
    (async () => {
      try {
        const QR = (await import('qrcode')).default;
        const url = await QR.toDataURL(value, {
          width: size * 2, margin: 1, errorCorrectionLevel: 'M',
          color: { dark: '#2A1810', light: '#FFFEFA' },
        });
        if (alive) setDataUrl(url);
      } catch (err) {
        console.warn('QR generation failed:', err);
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [value, size]);

  if (failed) {
    return (
      <p style={{ fontFamily: '"Outfit", sans-serif', fontSize: '12px', color: '#A83A56', wordBreak: 'break-all' }}>
        Couldn't draw the QR code. Use this link instead: {value}
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
      <div style={{ width: size, height: size, background: '#FFFEFA', borderRadius: '12px', padding: '10px', boxShadow: '0 2px 12px rgba(42,24,16,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {dataUrl
          ? <img src={dataUrl} alt={label || 'QR code'} style={{ width: '100%', height: '100%', display: 'block' }} />
          : <Loader2 size={22} className="spin" color="#5C3A21" />}
      </div>
      {label && (
        <span style={{ fontFamily: '"Outfit", sans-serif', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5C3A21', textAlign: 'center' }}>
          {label}
        </span>
      )}
    </div>
  );
};


// ── Motion helpers ──────────────────────────────────────────────

// Live, not cached: someone can flip the OS setting while the tab is open.
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Smooth scrolling is motion too. `behavior: 'smooth'` ignores the media
// query entirely, so it has to be decided in JS.
const scrollSoftly = (target, opts = {}) => {
  const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (target === window) window.scrollTo({ ...opts, behavior });
  else target?.scrollIntoView({ ...opts, behavior });
};

// Play an exit before unmounting. A panel that animates in and then simply
// vanishes breaks the expectation that things leave the way they arrived.
// Returns `closing` for the CSS class and `close(then?)` to start the exit.
function useDismiss(onDone, ms = 280) {
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const close = useCallback((then) => {
    if (closing) return;
    setClosing(true);
    const run = typeof then === 'function' ? then : onDone;
    timer.current = setTimeout(run, prefersReducedMotion() ? 0 : ms);
  }, [closing, onDone, ms]);

  return { closing, close };
}


// ── Swipe to dismiss ────────────────────────────────────────────
// The four principles the audit found unexercised, in one place:
//   §2 the surface tracks the finger 1:1 via Pointer Events + capture
//   §5 release velocity is handed to the exit rather than restarting at 0
//   §6 the landing point is PROJECTED from velocity, so a flick throws it
//      even from a short drag
//   §9 dragging the wrong way rubber-bands instead of hitting a wall
//
// Attach `handlers` to whatever should be grabbable; `ref` is the element
// that moves. Mouse is deliberately excluded — a pointer has a close
// button right there, and hijacking drag from it breaks text selection.
const DECEL = 0.998;
const projectMomentum = (v) => (v / 1000) * DECEL / (1 - DECEL);
const rubberband = (over, dim, c = 0.55) =>
  (over * dim * c) / (dim + c * Math.abs(over));

function useSwipeDismiss({ ref, axis = 'x', dir = 1, onDismiss, canStart }) {
  const st = useRef(null);

  const move = (px, transition) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = transition || 'none';
    el.style.transform = axis === 'x' ? `translateX(${px}px)` : `translateY(${px}px)`;
  };

  const onPointerDown = (e) => {
    if (prefersReducedMotion() || e.pointerType === 'mouse') return;
    if (canStart && !canStart()) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    st.current = {
      id: e.pointerId,
      x0: e.clientX, y0: e.clientY,
      committed: false,
      size: axis === 'x' ? r.width : r.height,
      hist: [{ t: performance.now(), p: axis === 'x' ? e.clientX : e.clientY }],
    };
  };

  const onPointerMove = (e) => {
    const s = st.current;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;

    // Hysteresis: don't steal a tap, and don't fight a scroll going the
    // other way. Decide intent once, then stay committed.
    if (!s.committed) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      const dominant = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (dominant !== axis) { st.current = null; return; }
      s.committed = true;
      try { ref.current?.setPointerCapture(s.id); } catch { /* noop */ }
    }

    const raw = axis === 'x' ? dx : dy;
    s.hist.push({ t: performance.now(), p: axis === 'x' ? e.clientX : e.clientY });
    if (s.hist.length > 6) s.hist.shift();

    const travel = raw * dir;
    // Past the boundary in the wrong direction, resist progressively.
    const shown = travel >= 0 ? travel : -rubberband(-travel, s.size);
    move(dir * shown);
  };

  const finish = (e) => {
    const s = st.current;
    if (!s || e.pointerId !== s.id) return;
    st.current = null;
    if (!s.committed) return;

    const last = s.hist[s.hist.length - 1];
    const first = s.hist[0];
    const dt = Math.max(1, last.t - first.t);
    const velocity = ((last.p - first.p) / dt) * 1000 * dir;   // px/s toward dismissal
    const travel = (axis === 'x' ? e.clientX - s.x0 : e.clientY - s.y0) * dir;
    const projected = travel + projectMomentum(velocity);

    if (projected > s.size * 0.34) {
      // Continue at the finger's speed rather than starting a new motion.
      const remaining = Math.max(60, s.size - travel);
      const ms = Math.min(420, Math.max(140, (remaining / Math.max(300, Math.abs(velocity))) * 1000));
      move(dir * s.size, `transform ${Math.round(ms)}ms cubic-bezier(0.22, 1, 0.36, 1)`);
      if (ref.current) ref.current.style.opacity = '0';
      setTimeout(onDismiss, Math.round(ms) - 40);
    } else {
      // Didn't earn it — spring home. Slight bounce is right here: the
      // gesture carried momentum.
      move(0, 'transform 420ms cubic-bezier(0.2, 1.12, 0.4, 1)');
    }
  };

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}

export { InfinityHeart, QrCode, useDismiss, useSwipeDismiss, prefersReducedMotion, scrollSoftly };
