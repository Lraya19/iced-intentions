// ═══════════════════════════════════════════════════════════════
// Iced Intentions — shared UI atoms
// ───────────────────────────────────────────────────────────────
// Used by the customer site, the staff POS and the kiosk. Kept out of
// App.jsx so the POS bundle can import them without pulling in the whole
// storefront.
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
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


export { InfinityHeart, QrCode };
