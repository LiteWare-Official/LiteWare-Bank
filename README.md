# Liteware Bank — setup

Plain HTML/CSS/JS, Firebase (Auth + Firestore), QR pay/receive.

## Files
- `index.html` / `app.js` — user app: sign up/in, balance, receive-QR, pay-by-scanning-QR, transaction history
- `admin.html` / `admin.js` — back office: user list, freeze/unfreeze, manual balance adjustment, transaction log
- `style.css` — shared styling
- `firestore.rules` — security rules to paste into the Firebase console

## One-time Firebase setup

1. **Enable Auth** — Firebase console → Authentication → Sign-in method → enable **Email/Password**.
2. **Enable Firestore** — Firestore Database → Create database.
3. **Paste `firestore.rules`** into Firestore → Rules, and publish.
4. **Create the admin login:**
   - Authentication → Users → Add user → email `admin@liteware.me`, password `iamadmin` (or your own — this is just the real credential behind the "admin" username).
   - Copy that user's UID.
   - Firestore → start a collection `admins` → document ID = that UID → add a field `role: "admin"`.
   - The admin panel's username field is just a friendly alias — `admin.js` maps the typed username to this email before calling Firebase Auth. Add more mappings in `USERNAME_TO_EMAIL` in `admin.js` if you add more admins.
5. Serve the folder over `http(s)` (camera access for QR scanning requires a secure context — `localhost` is fine for testing, e.g. `npx serve .`).

## How it works

- **Sign up** creates a `users/{uid}` doc with `balance: 0` and a generated `accountNumber`.
- **Receive** renders a QR encoding `{uid, acct}`.
- **Pay** scans that QR with the device camera, then runs a Firestore `runTransaction()` that debits the sender and credits the recipient atomically, followed by a `transactions` record.
- **Admin** can search accounts, freeze/unfreeze them, manually adjust balances (logged as `admin_adjustment` transactions), and view the last 50 transactions.

## Important limitations of a client-only build

Because there's no backend, all money-movement logic runs in the browser and is only as safe as the Firestore rules enforcing it. For a real banking product you'd normally want:

- **Cloud Functions** (or any server) to own all balance writes, so the logic can never be inspected or tampered with client-side, and so you can add fraud checks, rate limiting, and idempotency keys.
- **Custom claims** for admin (`request.auth.token.admin == true`) instead of a Firestore lookup, set server-side.
- Stricter validation than the included rules provide — the current rules are a reasonable client-side floor, not a substitute for server-enforced logic.

If/when you're ready to move past static hosting, the transfer logic in `sendPayment()` in `app.js` is a near-drop-in for a Cloud Function.
