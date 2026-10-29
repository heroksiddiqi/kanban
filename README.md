# Herok Kanban

A tiny Kanban board that syncs across devices. One HTML page, plain JavaScript, no build step,
no server of your own. The board lives in **Supabase** (Postgres + Realtime) and you sign in with
a **magic link** — no password to remember.

---

## Features

- **Columns**: add, rename, recolor (8 colors), reorder by dragging, delete (with confirmation).
  A dashed **“Add column”** tile sits at the end of the board.
- **Cards**: create, edit, delete; title, notes, color, due date, and a column picker for moving
  without dragging. Drag inside a column or across columns. Card titles default to **30px**, and a
  colored card gets a **flat, light wash** of its color (no gradient) while the title and notes keep
  their normal text colors.
- **Floating + button**: one tap to add a card — it opens in the column you are currently looking at.
- **Text size**: `A−` / `A+` in the header step through five sizes (Compact → Comfortable →
  Large → Extra large → Huge). Card titles go 22 → 26 → **30 (default)** → 34 → 38px; notes, buttons
  and column width scale together; remembered per browser.
- **Search** across titles and notes (`/` to focus).
- **Keyboard**: `N` new card, `/` search, `Esc` closes dialogs.
- **Light / dark** theme, remembered per browser.
- **Live sync**: changes made on one device show up on the others within a second, without reloading.
  A small footer pill shows the connection state (*Connecting… / Synced / Offline — retrying*).
- **JSON export / import** for backups.
- **Responsive, no separate mobile page**: the same `index.html` on phone and desktop. Columns sit in
  a wrapping grid — shrink the window and they reflow onto the next row instead of scrolling
  sideways, so there is never a horizontal scrollbar. Cards are never cut off: columns get as wide
  as one screen on phones and stay capped on very wide screens. The page scrolls vertically, the
  header sticks to the top, and touch targets / safe-area padding / the grip-handle drag are sized
  for fingers.

---

## How it works

| Piece | Role |
| ----- | ---- |
| Supabase Auth | magic-link sign-in; the session is kept in this browser's `localStorage` |
| `public.boards` | one row per user (the app is a single-board kanban) |
| `public.columns` | columns, soft-deleted with a `deleted` flag |
| `public.cards` | cards, also soft-deleted |
| Realtime | one channel per board; any change triggers a reload of the board |
| Row Level Security | every policy is `auth.uid() = user_id`, so a user can only touch their own rows |

Nothing is cached in the browser, so every device reads the same rows. The publishable key in
`src/config.js` is public by design — it is only safe because RLS is enabled. **Never** put a
`service_role` / secret key in this project.

---

## Setup (one time)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and run it
   once. It creates the tables, RLS policies, the `ensure_board()` bootstrap function and turns on
   Realtime for `columns` and `cards`.

   > The script starts with `drop table ...` statements. Do not re-run it on a board you care
   > about — export a JSON backup first.

3. In **Project Settings → API** copy the **Project URL** and the **publishable / anon key** into
   [`src/config.js`](src/config.js):

   ```js
   window.KB_CONFIG = {
     supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
     supabaseKey: 'sb_publishable_...'
   };
   ```

4. In **Authentication → URL Configuration** set:
   - **Site URL**: `https://your-deployed-url/` (or `http://localhost:8080` while testing)
   - **Redirect URLs**: add every origin you will open the board from, e.g.
     `http://localhost:8080/**` and `https://<you>.github.io/kanban/**`

   Without this, magic links redirect to `http://localhost:3000` and sign-in silently fails.

5. Optional but recommended before real use: **Authentication → Emails / SMTP**. Supabase's built-in
   mailer is rate-limited (a couple of messages per hour) and meant for testing only. With your own
   SMTP provider, sign-in links arrive reliably.

6. Sign in with your own email. The first sign-in creates your board and seeds three starter
   columns (To Do / Doing / Done).

---

## Run it locally

`file://` no longer works — the app needs an origin for auth and loads the Supabase SDK from a CDN.
Serve the folder over http:

```bash
python -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080`. Only one person (you) can sign in per Supabase project unless you
add more users, and each user gets their own private board.

---

## Deploy to GitHub Pages

1. Create a repository (e.g. `kanban`) and push these files to the `main` branch:

   ```bash
   git init
   git add .
   git commit -m "Kanban board"
   git branch -M main
   git remote add origin https://github.com/<your-username>/kanban.git
   git push -u origin main
   ```

2. On GitHub: **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/ (root)** → **Save**

3. Wait a minute. The board appears at `https://<your-username>.github.io/kanban/`.

4. Add that URL (with `/**`) to Supabase **Authentication → URL Configuration → Redirect URLs**,
   then update **Site URL** to the live address.

All paths are relative, so it works from a subfolder without any configuration.

### Deploy to Vercel

1. Push the repository to GitHub (as above).
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import that repository.
3. Framework preset: **Other**. Build command: *(empty)*. Output directory: `.` (leave as is).
4. **Deploy**. Every push to `main` redeploys automatically.
5. Add the Vercel URL to the Supabase redirect URLs.

---

## Backups

Data lives in your Supabase project, not in the browser:

- **⋯ → Export JSON** downloads the whole board (columns + cards).
- **⋯ → Import JSON** replaces the board with the file's contents on every device.
- **⋯ → Reset board** deletes everything and starts again with three empty columns.
- **⋯ → Sign out** ends the session on this device only; the board stays in your account.

### Row shapes

| Table     | Columns |
| --------- | ------- |
| `boards`  | `id, user_id, name, created_at` |
| `columns` | `id, board_id, user_id, title, color, position, deleted, created_at, updated_at` |
| `cards`   | `id, board_id, column_id, user_id, title, notes, color, due_date, position, deleted, created_at, updated_at` |

`created_at` / `updated_at` are epoch milliseconds. Ids are UUIDs generated on the client.

---

## Files

```
index.html            page shell, auth screen, dialogs
assets/style.css      theme variables + layout
src/config.js         Supabase URL + publishable key
src/store.js          Supabase data layer, auth, realtime subscription
src/sync.js           realtime status + debounced reload
src/board.js          state, rendering, create/update/delete, export/import
src/drag.js           pointer-based drag & drop (mouse + touch)
src/app.js            auth gate, toolbar, dialogs, search, shortcuts, theme
supabase/schema.sql   tables, RLS, ensure_board(), realtime — run once
```

## Known limitations

- One board per user account (by design for now).
- No offline editing: without a connection the board shows *Offline — retrying* and changes cannot
  be saved. Export a JSON backup if you need a snapshot.
- No undo (delete asks for confirmation instead).
- Drag & drop needs a modern browser (`pointer` events); iOS Safari 13+ / Chrome / Edge / Firefox.
- Magic links are single-use and expire; request a new one from the sign-in screen if needed.
