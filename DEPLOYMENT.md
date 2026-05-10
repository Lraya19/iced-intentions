# Iced Intentions — Deployment Guide

This guide walks you through getting your website live at **icedintentions.com** from scratch. No coding experience required.

**✨ Good news:** Your Supabase database has already been provisioned and configured. The credentials are pre-filled in `.env.example`. Phase 3 is already done.

**Total time:** ~50 minutes.
**Total cost:** ~$10/year for the domain. Everything else is free.

> 💡 **Tip:** Open this guide on one screen and the websites you're working on alongside it. Many steps say "copy this, paste that" — having both visible saves time.

---

## What you're about to set up

| Service | What it does | Status | Cost |
|---|---|---|---|
| **Node.js** | Lets your computer run the website locally | You install | Free |
| **GitHub** | Stores your code online (required for deployment) | You sign up | Free |
| **Supabase** | The database that tracks orders & time slots | ✅ Already set up | Free |
| **EmailJS** | Sends order emails to your inbox | You set up | Free |
| **Vercel** | Hosts the website on the internet | You sign up | Free |
| **Cloudflare** | Where you buy `icedintentions.com` | You buy domain | ~$10/year |

---

## Phase 1 — Install Node.js (5 min)

Node.js is the engine that runs the website on your computer for testing.

1. Go to **[nodejs.org](https://nodejs.org)**
2. Download the **LTS** version (the green button on the left)
3. Run the installer, click Next through everything, finish.
4. Open your **Terminal** (Mac: press ⌘+Space, type "Terminal") or **PowerShell** (Windows: Start menu, type "PowerShell")
5. Type this and press Enter:
   ```
   node --version
   ```
   You should see something like `v20.18.0`. If you do, ✅ done.

> 🪟 **Windows users:** If `npm install` later complains about "running scripts is disabled," paste this in PowerShell first:
> ```
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```
> Then type `Y` and press Enter.

---

## Phase 2 — Test the site on your computer (5 min)

1. Make sure you've unzipped the project folder somewhere easy to find (like Desktop). The folder should be called `iced-intentions`.
2. Open Terminal/PowerShell and navigate into it. Type `cd ` (with a space), then **drag the folder onto the terminal window**, then press Enter. Your prompt should now show the folder path.
3. Type:
   ```
   npm install
   ```
   This downloads the website's building blocks. Takes 1-2 minutes.
4. When it finishes, type:
   ```
   npm run dev
   ```
5. Your browser should open automatically to `http://localhost:3000`. **You should see the Iced Intentions website running on your computer.** 🎉

You can stop the local server anytime with **Ctrl+C** in the terminal.

---

## Phase 3 — Database setup ✅ Already done

Your Supabase project **"Iced-Intentions"** has been created in your **LR Projects** organization, hosted in **us-east-2** (Ohio — closest to Texas). The schema is set up:

- **`slots` table** — tracks booked pickup times per date
- **`events` table** — event/catering bookings
- **`orders` table** — every order placed (write-only for the public; you read via the dashboard)
- **`book_slot()` and `book_event()` functions** — atomic Postgres functions that prevent two customers from grabbing the same slot/date simultaneously
- **Real-time enabled** on slots and events, so taken slots disappear instantly across all customers

**To view/manage your database**: go to **[supabase.com/dashboard](https://supabase.com/dashboard)**, sign in with the Google account on your Supabase, and click on the **Iced-Intentions** project. You'll see:

- **Table Editor** (left sidebar) → view orders as they come in
- **SQL Editor** → run reports like "all orders this week"
- **Logs** → see real-time activity

The credentials are already in `.env.example` — Phase 5 covers copying them in.

---

## Phase 4 — Set up EmailJS (order emails) (15 min)

This is what emails you when a customer places an order.

### Create the account

1. Go to **[emailjs.com](https://www.emailjs.com)** → **Sign Up** (free).
2. Verify your email.

### Connect your email

1. In the EmailJS dashboard, click **"Email Services"** in the left sidebar.
2. Click **"Add New Service"** → choose **Gmail** (or whatever email you want orders sent to).
3. Click **"Connect Account"** and sign in with the Google account you want order notifications to go to.
4. Service name: `Iced Intentions`. **Copy the Service ID** that appears (looks like `service_abc1234`). Save it somewhere.
5. Click **Create Service**.

### Create the order email template

1. Click **"Email Templates"** in the sidebar → **"Create New Template"**.
2. Template name: `Order Notification`.
3. Fill in the fields:
   - **Subject:** `🧋 New order from {{customer_name}} — {{pickup_time}}`
   - **To Email:** `{{to_email}}`
   - **From Name:** `Iced Intentions Orders`
   - **Reply To:** `{{customer_email}}`
   - **Content** (paste this):
     ```
     New order received!

     Order #: {{order_id}}
     Pickup: {{pickup_date}} at {{pickup_time}}

     Customer:
     {{customer_name}}
     {{customer_phone}}
     {{customer_email}}

     Items:
     {{items}}

     Total: ${{total}}
     ```
4. Click **Save**. **Copy the Template ID** at the top (looks like `template_xyz789`).

### Create the event inquiry template

1. Click **"Create New Template"** again.
2. Name: `Event Inquiry`.
3. Fill in:
   - **Subject:** `💌 Event inquiry from {{customer_name}} for {{event_date}}`
   - **To Email:** `{{to_email}}`
   - **Reply To:** `{{customer_email}}`
   - **Content:**
     ```
     New event inquiry!

     Booking #: {{booking_id}}
     Event Type: {{event_type}}
     Date: {{event_date}} at {{event_time}}
     Duration: {{duration}} hours
     Estimated Guests: {{guests}}

     Contact:
     {{customer_name}}
     {{customer_phone}}
     {{customer_email}}

     Notes:
     {{notes}}
     ```
4. Save. **Copy this Template ID too**.

### Get your public key

1. Click **"Account"** in the left sidebar → **"General"**.
2. **Copy your Public Key** (under API Keys).

You should now have **4 things saved**:
- ✅ Service ID
- ✅ Order Template ID
- ✅ Event Template ID
- ✅ Public Key

---

## Phase 5 — Test locally with real services (10 min)

Now we plug the Supabase credentials (already provisioned) and EmailJS into your local site.

1. In your `iced-intentions` project folder, find the file called **`.env.example`**. Make a copy of it called **`.env`** (just `.env`, no extension).

   On Mac: in Terminal, navigate to the folder and run `cp .env.example .env`
   On Windows in PowerShell: `Copy-Item .env.example .env`
   Or manually: open the folder, copy `.env.example`, paste, rename the copy to `.env`

2. Open `.env` in any text editor (TextEdit, Notepad, VS Code — anything).

3. **The Supabase values are already filled in for you.** ✅ You only need to fill in:
   - Your owner email (top of file)
   - Your business phone, address, Instagram (top of file)
   - The 4 EmailJS values from Phase 4 (bottom of file)

   Final result should look like:
   ```
   VITE_OWNER_EMAIL=youremail@gmail.com
   VITE_BUSINESS_PHONE=(972) 555-0142
   VITE_BUSINESS_ADDRESS=Your real address here
   VITE_BUSINESS_INSTAGRAM=@icedintentions

   VITE_SUPABASE_URL=https://oljkbcylxftbobrfsbwm.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_sIQP8ZVG2Yr-DfB_3GXHjA_39_HHgrV

   VITE_EMAILJS_SERVICE_ID=service_abc1234
   VITE_EMAILJS_ORDER_TEMPLATE=template_xyz789
   VITE_EMAILJS_EVENT_TEMPLATE=template_def456
   VITE_EMAILJS_PUBLIC_KEY=your_public_key
   ```

4. Save the file. Stop your dev server (Ctrl+C in terminal) and restart it:
   ```
   npm run dev
   ```

5. **Test a real order:** click Order → pick a drink → checkout → fill in your info → place order. Two things should happen:
   - ✅ You get an email
   - ✅ Open your Supabase dashboard → Table Editor → `orders` table → see your test order

> 🚨 If you don't get the email: check the **spam folder**, and check the EmailJS dashboard "Email History" tab.
> 🚨 If the order isn't in Supabase: open browser console (F12 → Console tab) and look for red errors.

---

## Phase 6 — Deploy to Vercel (20 min)

Now we put your site on the actual internet.

### Push your code to GitHub

1. Go to **[github.com](https://github.com)** → sign up if you don't have an account.
2. Click the **+** icon top-right → **"New repository"**.
3. Repo name: `iced-intentions`. Set to **Private**. Don't check any boxes. Click **"Create repository"**.
4. GitHub shows you commands. Scroll down and click **"uploading an existing file"** link in the quick setup section.
5. **Drag your entire `iced-intentions` folder contents** into the upload area. Important: do NOT include the `node_modules` folder, the `dist` folder, or the `.env` file.
6. At the bottom, click **"Commit changes"**.

### Deploy to Vercel

1. Go to **[vercel.com](https://vercel.com)** → **Sign up with GitHub**.
2. After signing up, click **"Add New..."** → **"Project"**.
3. Find your `iced-intentions` repo and click **"Import"**.
4. Framework Preset should auto-detect as **Vite**. ✅
5. Expand **"Environment Variables"**. **Paste the contents of your `.env` file** — Vercel has a paste-multiple feature that imports them all at once.

   > ⚡ **Tip:** Don't manually retype these. Open `.env` → Select All → Copy → paste into Vercel's env var box.

6. Click **"Deploy"**. Wait ~2 minutes.
7. 🎉 You'll see a page saying "Congratulations!" with a link like `iced-intentions-abc123.vercel.app`. **Click it — your site is LIVE.**

Test placing an order on the live URL. Email should arrive, and the order should show up in Supabase.

---

## Phase 7 — Buy and connect your domain (15 min)

Now we point `icedintentions.com` at your live site.

### Buy the domain on Cloudflare

1. Go to **[cloudflare.com](https://www.cloudflare.com)** → sign up (free).
2. In the dashboard, click **"Domain Registration"** → **"Register Domains"** in the left sidebar.
3. Search for `icedintentions.com`. If available (~$10.44/year), click **"Purchase"**.
4. Fill in your contact info, payment info. Cloudflare automatically privacy-protects your info for free.
5. Complete purchase. Domain is yours within 5 minutes.

### Connect domain to Vercel

1. Back in **Vercel**, open your project → click **"Settings"** at the top → **"Domains"** in the left sidebar.
2. In the input box, type `icedintentions.com` and click **"Add"**. Then add `www.icedintentions.com` too.
3. Vercel shows you DNS records to add. Keep this tab open.
4. Open a new tab → **Cloudflare dashboard** → click your domain → **"DNS"** in the left sidebar → **"Records"**.
5. Click **"Add record"** and add what Vercel showed you. It'll be something like:
   - Type: `A`, Name: `@`, IPv4 address: `76.76.21.21` (whatever Vercel shows)
   - Type: `CNAME`, Name: `www`, Target: `cname.vercel-dns.com`
6. **Important:** Click the orange cloud icon next to each record to turn it gray (DNS only). Vercel handles SSL — Cloudflare's proxy can interfere.
7. Wait 5-10 minutes. Visit **https://icedintentions.com**. 🎉

> 🚨 **If it doesn't work after 30 minutes**, double-check the DNS records match exactly what Vercel showed.

---

## You're live! Now what?

### Where to view orders

**[supabase.com/dashboard](https://supabase.com/dashboard)** → Iced-Intentions → **Table Editor** → `orders` table.

You can also run quick reports in the **SQL Editor**, e.g.:

```sql
-- Today's orders
select customer->>'name' as name, total, pickup_time_display, items
from orders
where pickup_date = current_date::text
order by pickup_time;

-- This week's revenue
select sum(total) as revenue
from orders
where created_at > current_date - interval '7 days';

-- Most popular drinks (last 30 days)
select item->>'name' as drink, count(*) as orders
from orders, jsonb_array_elements(items) as item
where created_at > current_date - interval '30 days'
group by drink
order by orders desc;
```

### How to update the site later

When you want to change anything (prices, menu, hours):

1. Edit the relevant file in your local `iced-intentions` folder (most things live in `src/App.jsx`)
2. Test locally with `npm run dev`
3. Push the changes to GitHub (re-upload the changed file via GitHub's web interface, or use git if you know it)
4. Vercel automatically redeploys within ~1 minute. Done.

### Free tier limits

You won't hit these for a long time, but FYI:

- **Supabase**: 500MB database + 5GB bandwidth + unlimited API requests/month (a coffee shop won't hit any of these in years)
- **EmailJS**: 200 emails/month (upgrade for $9/mo if you outgrow it)
- **Vercel**: 100GB bandwidth/month (a coffee shop site uses ~1GB)

> 🚨 **Important Supabase note**: free-tier projects pause after **7 days of zero activity**. As long as the site gets at least one visitor a week, you're fine. If it ever pauses, just visit the Supabase dashboard and click "Restore" — takes 30 seconds.

### When you should consider Phase 2 features

Once you're running orders for a few weeks, common upgrades:

- **Owner dashboard** — daily/weekly sales charts, popular drinks, repeat customers, all on a private admin page
- **Stripe checkout** — accept payment online before pickup
- **SMS confirmations** via Twilio
- **Loyalty program** — every 10 drinks free, etc.

Just message me when you're ready and I'll build whichever you want next.

---

## Help, something's broken

| Problem | Fix |
|---|---|
| `npm install` errors | Make sure you installed Node.js, then close and reopen your terminal |
| Windows: "running scripts is disabled" | Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` in PowerShell, type Y |
| Site looks broken locally | Stop dev server (Ctrl+C), delete `node_modules` folder, run `npm install` again |
| Order email not arriving | Check spam, check EmailJS Email History tab, verify Service/Template IDs in `.env` |
| Time slots not syncing | Verify Supabase config in `.env`, check browser console for errors (F12 → Console tab) |
| Order not appearing in Supabase | Open browser console (F12), look for errors when placing the order |
| Domain not loading | DNS propagation can take up to a few hours. Try `https://` not `http://` |
| Vercel deploy fails | Read the error log in Vercel dashboard. Most common cause: a missing env variable |

For anything else, send me the error message and I'll help debug.
