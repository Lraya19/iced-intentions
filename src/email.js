// ─────────────────────────────────────────────────────
// Email Service (EmailJS)
// ─────────────────────────────────────────────────────
// Sends order confirmations to the owner. If EmailJS env vars
// aren't set, logs to console so dev/local works without setup.

const EMAILJS = {
  serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID,
  orderTemplate: import.meta.env.VITE_EMAILJS_ORDER_TEMPLATE,
  eventTemplate: import.meta.env.VITE_EMAILJS_EVENT_TEMPLATE,
  publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
};

const OWNER_EMAIL = import.meta.env.VITE_OWNER_EMAIL || 'owner@example.com';

const isEmailConfigured = Boolean(EMAILJS.serviceId && EMAILJS.publicKey);

const sendViaEmailJS = async (templateId, params) => {
  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS.serviceId,
      template_id: templateId,
      user_id: EMAILJS.publicKey,
      template_params: params,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`EmailJS failed (${response.status}): ${text}`);
  }
};

export const sendOrderEmail = async (order) => {
  const params = {
    to_email: OWNER_EMAIL,
    order_id: order.id,
    customer_name: order.customer.name,
    customer_phone: order.customer.phone,
    customer_email: order.customer.email || '(not provided)',
    pickup_date: order.pickupDate,
    pickup_time: order.pickupTimeDisplay,
    items: order.items
      .map(i => `${i.qty}× ${i.name} (${i.size === 'L' ? 'Large' : 'Bucket'})${i.notes ? ` — "${i.notes}"` : ''} — $${i.lineTotal.toFixed(2)}`)
      .join('\n'),
    total: order.total.toFixed(2),
  };

  if (!isEmailConfigured) {
    console.log('📧 [Demo Mode] Order email would send to:', OWNER_EMAIL);
    console.log(params);
    return { sent: false, demoMode: true };
  }

  await sendViaEmailJS(EMAILJS.orderTemplate, params);
  return { sent: true };
};

export const sendEventEmail = async (booking) => {
  const params = {
    to_email: OWNER_EMAIL,
    booking_id: booking.id,
    event_type: booking.eventType,
    event_date: booking.date,
    event_time: booking.time,
    duration: booking.duration,
    guests: booking.guests || '(not provided)',
    customer_name: booking.name,
    customer_email: booking.email,
    customer_phone: booking.phone,
    notes: booking.notes || '(none)',
  };

  if (!isEmailConfigured) {
    console.log('📧 [Demo Mode] Event email would send to:', OWNER_EMAIL);
    console.log(params);
    return { sent: false, demoMode: true };
  }

  await sendViaEmailJS(EMAILJS.eventTemplate, params);
  return { sent: true };
};
