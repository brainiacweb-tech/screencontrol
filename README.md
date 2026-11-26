# ScreenControl

ScreenControl is a React/Vite event-display manager for four Samsung TVs. The dashboard and TV display pages use Supabase Authentication, PostgreSQL, Storage, and Realtime; the administrator's computer is not the playback server.

## What is implemented

- Email/password sign-in with administrator, operator, and viewer roles.
- Four seeded screen records, one-time pairing codes, anonymous TV sessions, and heartbeat-based online status.
- Private picture/video uploads and per-screen media authorization.
- Tap-to-select, drag-and-drop, single-screen and multi-screen assignments.
- Picture/video playlists, announcement cards, programme entries, and server-timestamped countdowns with pause, resume, and stop.
- Realtime assignment updates, with TV-side reconnection and media URL renewal.

The app does not ship with mock screen connections or simulated playback confirmations. A screen is shown online only after it reports a recent heartbeat.

## Supabase setup

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/migrations/202611250001_screencontrol.sql`](./supabase/migrations/202611250001_screencontrol.sql). This creates the tables and policies, seeds the four TVs, and creates the private `screen-media` bucket.
3. In **Authentication → Sign In / Providers**, enable email/password, anonymous sign-ins, and public email sign-up. Anyone can register; new accounts default to `viewer`. Configure the project's **URL Configuration** with the app's site URL and allowed redirect URLs so confirmation links return to the app. Disable public sign-up if the workspace should be invite-only.
4. After the first administrator has registered and confirmed their email, find their user ID in **Authentication → Users** and promote them in the SQL Editor:

   ```sql
   update public.user_profiles
   set role = 'administrator'
   where id = 'AUTH_USER_UUID';
   ```

   Self-registered users default to `viewer`. To grant operator access:

   ```sql
   update public.user_profiles
   set role = 'operator'
   where id = 'AUTH_USER_UUID';
   ```

   Manage account roles in Supabase. Operators can run screens and manage event content. Viewers can monitor screens and the programme.
5. Copy `.env.example` to `.env.local` and set the Supabase project URL and **publishable/anon key**. Never put a service-role key in a `VITE_` variable or browser code.

The SQL migration creates the storage bucket and policies automatically. It does not expose media publicly. Pairing codes are hashed, expire after 10 minutes, and are invalidated after repeated incorrect attempts.

## Run locally

```powershell
npm install
npm run dev
```

Open the Vite URL and sign in with an invited account. `npm run build` type-checks and creates the production build; `npm run lint` runs Oxlint.

## Pair and run a TV

1. Deploy the site over HTTPS and open **My screens** on an operator's laptop or phone.
2. On the TV's built-in browser, open the pairing URL shown in that TV's card.
3. Generate or refresh the one-time pairing code in the dashboard and enter it on the TV.
4. Keep the display page open. The TV will remember its anonymous device session and reconnect to Supabase after network interruptions.
5. Use **Media library** to upload supported files, choose one or more screens, and press **Play**. You can also drag a media card onto a screen card.

The display route supports links in `/display/<screen-uuid>` form. A display needs internet access to receive live changes. Signed media links are refreshed by the display while it is online. MP4 browser support depends on the file's codec and the TV's firmware; muted autoplay is attempted, with a tap-to-play prompt if the browser blocks it. Full-screen mode must be entered from the TV browser's user interaction.

## Deploy to Vercel

1. Import the project into Vercel and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as project environment variables.
2. Deploy with the default Vite build command (`npm run build`) and output directory (`dist`).
3. Add the deployed HTTPS origin to the Supabase project's allowed authentication redirect URLs.

The included `vercel.json` provides SPA fallback routing for TV display URLs. Deployment, cloud credentials, and compatibility testing on physical Samsung TV models must be completed in the target Supabase/Vercel accounts and on the target hardware.
