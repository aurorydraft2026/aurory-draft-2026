# Asgard Duels Copilot Instructions

## Architecture Overview
- **Frontend**: React SPA in `client/` using Firebase Auth, Firestore, and Cloud Functions
- **Backend**: Firebase (Auth, Firestore in eur3, Functions in TypeScript)
- **External Integration**: Aurory API (game/NFT platform) proxied via `auroryProxy` function to avoid CORS
- **Data Flow**: Client reads/writes Firestore directly; uses callable functions for complex logic; proxies Aurory API calls
- **Key Components**: Tournaments (drafts/matches), mini-games, raffles, cosmetics, user tiers/referrals

## Core Patterns
- **Authentication**: Anonymous sign-in initially, upgrade to real auth; roles in Firestore users collection (`superadmin`, `admin`, `games_manager`, `user`)
- **Drafts**: Stored in `/drafts/{id}` with permissions object; phases advance via timers; matches verified against Aurory API
- **Match Verification**: Fetch from Aurory `/v1/matches` by battle code; check player IDs and "amikos" (creatures); disqualify on mismatch
- **Services**: API calls in `client/src/services/` (e.g., `auroryAPI.js` for cached requests, `matchVerificationService.js` for validation)
- **Hooks**: Custom state management in `client/src/hooks/` (e.g., `useAuth.js`, `useLeaderboard.js`)
- **Admin Panel**: Large component in `AdminPanel.js` handling all admin ops via Firestore transactions

## Developer Workflows
- **Local Dev**: `cd client && npm start` (React dev server); `cd functions && npm run serve` (emulators)
- **Build**: `cd client && npm run build`; `cd functions && npm run build` (TypeScript to `lib/`)
- **Deploy**: `firebase deploy --only hosting` (from `client/build`); `firebase deploy --only functions` (prebuilds via `firebase.json`)
- **Debugging**: Check `build_errors.txt`; use `firebase functions:log`; emulators for functions testing
- **Migrations/Scripts**: Run from `scripts/` with `node migrateTiers.js` (uses `firebase-admin`)

## Key Files
- `client/src/App.js`: Main router with maintenance mode and referral handling
- `firestore.rules`: Complex permissions for drafts/users (read for role checks)
- `functions/src/index.ts`: Scheduled functions (`checkTimers` every 5s, `verifyMatches` every 2min)
- `client/src/services/auroryProxyClient.js`: Client-side proxy caller for Aurory API
- `functions/src/auroryProxy.ts`: Server-side proxy implementation

## Conventions
- Use `auroryFetch()` from `auroryProxyClient.js` for all Aurory API calls (handles CORS)
- Firestore writes: Use transactions for atomic ops (e.g., in `AdminPanel.js`)
- Error Handling: Log to console; return `{success: false, error}` objects
- Caching: Implement in services (e.g., 5min cache in `auroryAPI.js`)
- Notifications: Use `createNotification()` from `notifications.js` for user alerts