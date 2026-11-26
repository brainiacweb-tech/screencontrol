# ScreenControl

ScreenControl is a web app for managing event content on up to four Samsung TV displays. Use the dashboard from a laptop or phone to pair TVs, upload media, choose what each screen shows, and keep an event programme visible. Each TV loads its own display page and connects to Supabase; the dashboard computer is not a playback server.

## What the system does

- Provides a dashboard with an overview, screen status, media library, programme, and recent activity.
- Uses Supabase email/password accounts with administrator, operator, and viewer roles.
- Pairs each TV to a screen record using a one-time six-digit code.
- Stores pictures and videos in a private Supabase Storage bucket.
- Publishes content to one screen or several screens with realtime updates.
- Displays pictures, videos, playlists, announcements, countdowns, and the event programme.
- Sends TV heartbeats so the dashboard can distinguish a recently connected screen from one that is offline.

The database migration seeds four screens: `SAMSUNG TV 1` through `SAMSUNG TV 4`. A screen is not shown as online just because it has been registered or paired; it must report a recent heartbeat.

## Before you start

You will need:

- A Supabase account and project.
- A GitHub repository and Vercel account if you intend to deploy the app.
- A laptop or phone for the operator dashboard.
- Samsung TVs with a browser and internet access.
- Supported content files: JPG, PNG, WebP, or MP4, up to 100 MB per file.

Keep the Supabase database password private. The browser app only uses the Supabase project URL and publishable/anon key; it must never use a service-role key.

## First-time setup

Complete these steps in order. The database, authentication providers, and app environment variables all need to point to the same Supabase project.

### 1. Create a Supabase project

1. Sign in at [Supabase](https://supabase.com) and create a project.
2. Choose a project name, a strong database password, and a region suitable for the event location.
3. Wait until the project is fully provisioned.
4. Open **Project Settings → API** and note the project URL and publishable key (or legacy anon key). You will add these to the app later.

Do not copy the `service_role` key into the app. Anything with a `VITE_` prefix is bundled for use in a browser and is not secret.

### 2. Create the database tables and policies

1. Open the project’s **SQL Editor** in Supabase.
2. Open [`supabase/migrations/202611250001_screencontrol.sql`](./supabase/migrations/202611250001_screencontrol.sql) in this repository.
3. Copy the complete SQL file into a new SQL Editor query.
4. Run the query and confirm that it completes without errors.

The migration creates the application tables, security policies, pairing and playback functions, Realtime publication entries, the private `screen-media` bucket, and the four seeded screens with standby assignments. It is intended as the project’s initial migration; do not casually rerun it against a live database.

For an existing project, apply each newer migration in order as well. In particular, [`supabase/migrations/202611260001_backfill_user_profiles.sql`](./supabase/migrations/202611260001_backfill_user_profiles.sql) creates viewer profiles for existing non-anonymous accounts that were created before the profile trigger was installed. This is safe to run more than once.

### 3. Enable Supabase authentication

In the Supabase dashboard, go to **Authentication → Sign In / Providers** (the exact menu wording may vary) and enable:

- **Email/password** for dashboard accounts.
- **Anonymous sign-ins** for paired TVs. Each display uses a separate anonymous session rather than a person’s account.
- **Email sign-up** if people should be able to register themselves.

Self-registered accounts start as viewers. If the workspace should be invite-only, disable public sign-up after you have arranged how users will be invited or provisioned.

### 4. Set authentication URL configuration

In **Authentication → URL Configuration**:

1. Set the **Site URL** to the URL users will normally visit.
2. Add the development URL and deployed HTTPS URL to **Allowed Redirect URLs** as appropriate.

For local development, the Vite URL is usually `http://localhost:5173` or `http://127.0.0.1:5173`. For production, use the exact Vercel HTTPS origin, for example `https://your-project.vercel.app`. Correct redirect configuration is needed for email confirmation and authentication redirects.

### 5. Configure the app's Supabase keys

In the project folder, copy `.env.example` to `.env.local`:

```powershell
Copy-Item .env.example .env.local
```

Edit `.env.local` and set the values from **Project Settings → API**:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

Do not add quotation marks unless they are part of the actual value. Never put a database password or service-role key in this file. `.env.local` is excluded from Git.

Restart the Vite server after changing environment variables. If the app shows the setup screen, verify both values and restart the server.

### 6. Install dependencies and run locally

From the project directory, run:

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`. The dashboard needs internet access to connect to Supabase.

Useful project checks:

```powershell
npm run build
npm run lint
```

`npm run build` type-checks the app and creates the production files in `dist`. `npm run lint` runs Oxlint.

### 7. Register the first administrator

1. On the app sign-in page, choose **New here? Create an account**.
2. Enter the administrator’s email address and create a password.
3. If email confirmation is enabled, open the confirmation email and follow its link.
4. In Supabase, go to **Authentication → Users** and copy the new account’s user UUID.
5. In **SQL Editor**, run the following query, replacing the placeholder with that UUID:

   ```sql
   update public.user_profiles
   set role = 'administrator'
   where id = 'AUTH_USER_UUID';
   ```

6. Return to the app and sign in. Refresh if the dashboard was already open when the role was changed.

The account profile is created after a non-anonymous user registers. If the SQL update affects zero rows, first confirm the account exists and that the email has been confirmed.

### 8. Give other people access

Create or invite their account using your chosen Supabase account process. After the account exists, find its UUID under **Authentication → Users** and set its role in the SQL Editor.

To grant operator access:

```sql
update public.user_profiles
set role = 'operator'
where id = 'AUTH_USER_UUID';
```

To explicitly set a person back to viewer:

```sql
update public.user_profiles
set role = 'viewer'
where id = 'AUTH_USER_UUID';
```

Use the real UUID in place of `AUTH_USER_UUID`. Roles are managed in Supabase, not from the ScreenControl dashboard.

| Role | Typical permissions |
| --- | --- |
| Administrator | Operate screens and event content; manage account roles in Supabase. |
| Operator | Pair screens, upload media, and control displays and programme content. |
| Viewer | Monitor screen status and the programme without operating screens. |

## Deploy to Vercel

1. Push the project to a GitHub repository.
2. In Vercel, choose **Add New → Project** and import that repository.
3. In the Vercel project settings, add these environment variables for the deployments you will use:

   ```text
   VITE_SUPABASE_URL
   VITE_SUPABASE_ANON_KEY
   ```

   Set them to the same Supabase project values used during setup. These are browser-safe publishable/anon credentials, not service-role credentials.

4. Use the Vite defaults:
   - Build command: `npm run build`
   - Output directory: `dist`
5. Deploy and open the resulting HTTPS URL.
6. Return to Supabase **Authentication → URL Configuration** and add the Vercel HTTPS origin to the allowed redirect URLs. Set it as the Site URL if it is the primary production address.
7. Open the deployed app and sign in to confirm it reaches the same Supabase project.

The included [`vercel.json`](./vercel.json) provides SPA fallback routing for URLs such as `/display/<screen-uuid>`. Each new Vercel deployment can use its own URL; make sure the URL used by the TVs is included in Supabase’s redirect configuration where needed.

## Step-by-step: operate the system

### 1. Sign in and check the dashboard

Sign in with an administrator or operator account. The sidebar contains:

- **Overview**: online screens, screens with content, media count, recent activity, and upcoming programme.
- **My screens**: pair TVs, see online/offline state, choose a screen to change, pause/resume, or stop its current display.
- **Media library**: upload, select, and publish pictures or videos.
- **Programme**: create event activities and show the schedule on selected TVs.

The **Live updates** indicator shows whether the dashboard has an active Supabase Realtime connection. Use the refresh button if you need to reload current data.

On the Overview, **Screens online** counts screens with a recent heartbeat. A paired TV may still show Offline if its browser is closed, it lost internet, or it has not sent a recent heartbeat. **Showing content** reflects whether an assignment record exists; the database creates standby assignments too, so this number is not a playback confirmation and does not prove that the TV rendered a media file.

### 2. Pair each TV

Pair every physical TV once, and repeat the steps if you intentionally need to pair it again.

1. In the dashboard, open **My screens**.
2. Find the card for the intended TV, such as `SAMSUNG TV 1`.
3. Select its pairing menu (the three-dot control). The pairing dialog displays that TV’s unique address, in this form:

   ```text
   https://your-domain/display/<screen-uuid>
   ```

4. Open that address in the TV’s built-in browser.
5. In the dashboard dialog, wait for the six-digit one-time code to appear. Keep the dialog open while entering it.
6. Enter the code on the TV and choose **Connect this TV**.
7. Confirm that the TV display says Connected and that the dashboard screen card becomes Online.
8. Repeat for each TV. Each display URL and code belongs to one screen; do not reuse another TV’s code.

Codes expire after 10 minutes and can only be used once. Repeated incorrect attempts invalidate a code. If a code expires or is rejected, generate a new code from the same screen card and try again.

Keep the TV’s display page open during the event. The TV uses an anonymous device session and sends a heartbeat periodically. It reconnects after network interruptions, but cannot receive new content while it is disconnected.

### 3. Upload pictures and videos

1. Open **Media library**.
2. Choose **Add picture or video** (or **Choose files** if the library is empty).
3. Select one or more files from the laptop or phone.
4. Wait for the upload to finish and check that each item appears in the library.

Supported formats and limits:

- Pictures: JPG/JPEG, PNG, and WebP.
- Video: MP4.
- Maximum file size: 100 MB per file.

The storage bucket is private. The app creates temporary signed links for authorized screens rather than making uploaded media publicly accessible.

For best compatibility across TV browsers, test the actual files on the target TVs before the event. MP4 is a container format; the video and audio codecs inside the file still need to be supported by the TV firmware.

### 4. Choose screens and play content

1. In **Media library**, click a media card to select it. Click again to deselect it.
2. Under **PLAY ON**, choose **All screens** or toggle individual screen chips.
3. For an image or playlist, set **Image duration** in seconds if needed. The allowed range is 3 to 600 seconds; the default is 12 seconds.
4. If multiple items are selected, they play as a playlist in the order selected. Choose **Repeat playlist** if it should start over after the last item.
5. Select **Play on ... screens** to publish.
6. Watch the dashboard screen cards and TV displays for the update.

You can also drag a media card directly onto a screen card to send that item to just that screen. On the Overview or My screens page, choose **Change content** on a screen to open the media library targeted at that screen.

Use the pause/resume control on the screen card to pause or continue eligible media and countdowns. Use **Stop display** to return that screen to standby. Stopping a screen replaces its current assignment; it does not delete the media file.

### 5. Show an announcement

1. From Overview, choose **Show an announcement**.
2. Enter a heading (up to 80 characters) and message (up to 500 characters).
3. Select one or more target screens.
4. Choose **Display announcement**.

The announcement replaces the content currently assigned to each selected screen. To show media again, publish the media to those screens.

### 6. Start and control a countdown

1. From Overview, choose **Start a timer**.
2. Enter a title (up to 70 characters) and a duration from 1 to 240 minutes.
3. Select the target screens.
4. Choose **Start countdown**.
5. Pause or resume it from the screen card when needed. Use **Stop display** to end it and return that screen to standby.

The countdown is based on server timestamps so that its displayed time is not dependent on the operator computer’s clock. A countdown reaching zero does not itself advance the event; an operator should publish the next content.

### 7. Add and show the programme

1. Open **Programme**.
2. Choose **Add activity**.
3. Enter an activity name, optional presenter, start time, and end time. The end must be later than the start.
4. Choose **Add to programme**.
5. Add any remaining activities in schedule order.
6. Select target screens under **SHOW ON**.
7. Choose **Show programme** to display the schedule on those TVs.

The TV programme display shows the activity happening now and upcoming entries. Programme items are shared across the workspace, while the choice of which TVs show the programme is made when publishing it.

### 8. End or change a display

- To replace content, select and publish different content to that screen.
- To pause or resume supported media/countdowns, use the screen card control.
- To clear a screen back to standby, use **Stop display**.
- To confirm the change, check the screen’s assignment on the dashboard and the TV itself.

## How online status and playback work

- The TV display sends a heartbeat about every 20 seconds. The dashboard considers a screen online only while its last heartbeat is recent (less than about one minute old).
- The display receives assignments using Supabase Realtime. A reconnect triggers a reload of the screen state.
- The app may keep the last display state locally so it can recover the display page during a temporary connection failure. This does not allow new assignments to arrive while offline.
- Supabase Storage files are private. The display requests temporary signed media URLs for content assigned to that TV and refreshes the URLs while running.
- Muted autoplay is attempted for videos because TV browsers often block autoplay with sound. If autoplay is blocked, interact with the TV browser and use the on-screen **Tap to play video** prompt.
- Use the TV browser’s full-screen control from a user interaction. Full-screen support depends on that browser and its firmware.

## Troubleshooting

### The app shows “One quick setup step”

- Confirm `.env.local` exists in the project root.
- Check that both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set to the intended project values.
- Make sure you did not use a service-role key.
- Stop and restart `npm run dev` after changing the file.

### The dashboard shows an error or no screens

- Confirm the migration ran successfully in the same Supabase project used by the app.
- Confirm `.env.local` or the Vercel environment variables point to that project.
- In the browser, refresh the dashboard and check the exact error notification.
- Confirm the account is signed in and has the expected role.

### Sign-up, sign-in, or email confirmation fails

- Verify email/password authentication is enabled.
- Verify public email sign-up is enabled if you are registering through the app.
- Check the confirmation email, including spam or junk folders.
- Confirm the app URL is listed in Supabase **Authentication → URL Configuration**.
- Ensure that the project’s Site URL and app environment variables refer to the same deployment/project.

### A new account cannot operate screens

New accounts start as viewers. In Supabase **Authentication → Users**, copy the account UUID, then use SQL Editor to change its role to `operator` or `administrator`. Refresh the app after the change. Only administrators and operators can pair screens or publish content.

### A TV is not paired or stays offline

- Confirm the TV URL uses the correct screen UUID and the intended deployment.
- Confirm anonymous sign-ins are enabled.
- Generate a new pairing code and enter it before its ten-minute expiry.
- Check that the TV has internet access and that its display page is still open.
- After successful pairing, wait for the next heartbeat and check that the TV display reports Connected.
- If the TV is offline, it cannot receive live assignments until it reconnects.

### Media upload fails or media does not play

- Confirm the file is JPG, PNG, WebP, or MP4 and no larger than 100 MB.
- Confirm the migration created the `screen-media` bucket and its policies.
- Check the exact error message in the dashboard.
- Test the MP4 directly on the target TV. Firmware/browser codec support varies even among MP4 files.
- If a video is visible but does not start, use the TV browser’s user interaction to start playback.

### Realtime updates appear delayed

- Check the dashboard’s **Live updates** indicator.
- Confirm the TV is online and the TV display page is active.
- Refresh the dashboard or reload the TV display page after restoring internet access.
- Verify the migration completed, including its Realtime publication setup.

## Security and operations notes

- Never put a service-role key, database password, or other private credential in frontend code or a `VITE_` variable.
- Keep `.env.local` local; it is ignored by Git. Set browser-safe project values in the deployment provider for production.
- Supabase sign-up, role assignment, and storage policies should be reviewed for the intended event audience.
- Pairing codes are short-lived and single-use; share them only with the person pairing that TV.
- Uploaded media is stored privately and is served using signed URLs for authorized displays.
- Test account access, network reconnection, media playback, and full-screen behavior on the actual TVs before relying on them at an event.

## Reference

- Supabase migration: [`supabase/migrations/202611250001_screencontrol.sql`](./supabase/migrations/202611250001_screencontrol.sql)
- Example environment variables: [`.env.example`](./.env.example)
- Vercel SPA routing: [`vercel.json`](./vercel.json)
