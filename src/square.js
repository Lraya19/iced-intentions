// ═══════════════════════════════════════════════════════════════
// Iced Intentions — Square Web Payments SDK helper (frontend)
// ───────────────────────────────────────────────────────────────
// Loads the Square SDK, initializes the card + Apple Pay payment
// methods, tokenizes the card, and calls our Supabase Edge Function
// to actually charge it. The secret token lives only in the Edge
// Function — this file only ever handles the public Application ID
// and one-time card tokens.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase";

// These come from Vite env vars (set in .env and in Vercel).
const SQUARE_APP_ID = import.meta.env.VITE_SQUARE_APP_ID;
const SQUARE_LOCATION_ID = import.meta.env.VITE_SQUARE_LOCATION_ID;
const SQUARE_ENV = (import.meta.env.VITE_SQUARE_ENV || "sandbox").toLowerCase();

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// The SDK script URL differs by environment.
const SDK_SRC = SQUARE_ENV === "production"
  ? "https://web.squarecdn.com/v1/square.js"
  : "https://sandbox.web.squarecdn.com/v1/square.js";

let sdkLoadPromise = null;

// Returns true if Square is configured at all (lets the UI degrade
// gracefully to pay-at-pickup if env vars are missing).
export const isSquareConfigured = () =>
  Boolean(SQUARE_APP_ID && SQUARE_LOCATION_ID);

// Dynamically inject the Square SDK <script> once.
function loadSquareSdk() {
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise((resolve, reject) => {
    if (window.Square) {
      resolve(window.Square);
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.onload = () => {
      if (window.Square) resolve(window.Square);
      else reject(new Error("Square SDK loaded but window.Square is missing."));
    };
    script.onerror = () =>
      reject(new Error("Failed to load the Square payment SDK."));
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

// Initializes a Payments instance + Card. Caller mounts the card into
// a container element id. Returns { payments, card, attachApplePay }.
export async function initSquarePayments(cardContainerId) {
  const Square = await loadSquareSdk();
  const payments = Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);

  // Card form, styled to match the brand.
  // NOTE: Square's SDK only accepts a limited set of style properties and
  // selectors. It rejects custom fonts like "Outfit" and the ::placeholder
  // selector, so we keep styling minimal and SDK-safe here.
  const card = await payments.card({
    style: {
      input: {
        color: "#2A1810",
        fontSize: "16px",
      },
      ".input-container": {
        borderColor: "rgba(92, 58, 33, 0.2)",
        borderRadius: "4px",
      },
      ".input-container.is-focus": {
        borderColor: "#E8A4B8",
      },
      ".input-container.is-error": {
        borderColor: "#A83A56",
      },
    },
  });
  await card.attach(`#${cardContainerId}`);

  return { payments, card };
}

// Sets up Apple Pay. Returns the applePay payment method or null if
// unavailable (wrong device/browser, not verified, etc.). The button
// is rendered by the caller; tokenization happens on click.
//
// NOTE: Apple Pay is temporarily DISABLED until domain verification is
// completed in Square. The card form works for everyone (including iPhone
// users) in the meantime. To re-enable later, delete the line below.
export async function initApplePay(payments, amount) {
  return null; // ← Apple Pay disabled; remove this line to re-enable once verified
  // eslint-disable-next-line no-unreachable
  try {
    const paymentRequest = payments.paymentRequest({
      countryCode: "US",
      currencyCode: "USD",
      total: {
        amount: amount.toFixed(2),
        label: "Iced Intentions",
      },
    });
    const applePay = await payments.applePay(paymentRequest);
    return applePay;
  } catch (err) {
    // Apple Pay not available on this device/browser — that's fine.
    console.log("Apple Pay unavailable:", err?.message || err);
    return null;
  }
}

// Tokenizes a payment method (card or applePay) into a one-time nonce.
export async function tokenize(paymentMethod) {
  const result = await paymentMethod.tokenize();
  if (result.status === "OK") {
    return result.token;
  }
  // Build a readable error from Square's tokenization errors.
  let message = "We couldn't read your card. Please check the details.";
  if (result.errors && result.errors.length > 0) {
    message = result.errors[0].message || message;
  }
  throw new Error(message);
}

// Calls our Supabase Edge Function to charge the tokenized card.
// Returns { success, paymentId, receiptUrl, status, amountCharged, ... } or throws.
//
// NOTE: we deliberately do NOT send a price. The Edge Function re-prices the
// whole cart from `items` against its own price list, so a tampered client
// can't dictate what it pays. It also derives the loyalty user from the
// signed-in session's JWT rather than a client-supplied id.
export async function chargePayment({ sourceId, orderId, redeem, items, buyerEmail, pickupDate, pickupTime, note }) {
  // Send the user's own access token when signed in, so the server can
  // trust who they are; fall back to the anon key for guest checkout.
  let authToken = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) authToken = data.session.access_token;
  } catch { /* not signed in — guest checkout */ }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ sourceId, orderId, redeem, items, buyerEmail, pickupDate, pickupTime, note }),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Payment server returned an unexpected response.");
  }

  if (!res.ok || !data.success) {
    throw new Error(data?.error || "Your payment could not be processed.");
  }
  return data;
}
