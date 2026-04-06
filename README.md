# Solo Leveling System Notification Backend

Minimal Node backend for Android web push while the PWA frontend stays on GitHub Pages.

## What it does

- Stores push subscriptions by device
- Stores a compact gameplay snapshot from the app
- Sends a real test push
- Chooses scheduled notifications for:
  - Daily Briefing
  - Reward Ready
  - Decay Warning
  - Raid Action Available
  - Evening Closeout

## Quick Start

1. In this folder run `npm install`
2. Generate VAPID keys with `npm run generate:vapid`
3. Copy `.env.example` to `.env` and paste the generated keys
4. Set `ALLOWED_ORIGIN` to your GitHub Pages URL
4. Start locally with `npm start`

## Frontend Wiring

In the GitHub Pages frontend, edit `push-config.js` and set:

```js
window.SYSTEM_PUSH_CONFIG = {
  publicKey: 'YOUR_PUBLIC_VAPID_KEY',
  subscribeUrl: 'https://your-backend.example.com/api/notifications/subscribe',
  stateSyncUrl: 'https://your-backend.example.com/api/notifications/state',
  testUrl: 'https://your-backend.example.com/api/notifications/test'
};
```

## API

- `GET /health`
- `POST /api/notifications/subscribe`
- `POST /api/notifications/state`
- `POST /api/notifications/test`
- `POST /api/notifications/dispatch`

## Example Cron

Call the dispatch endpoint every 15 minutes:

```bash
curl -X POST "https://your-backend.example.com/api/notifications/dispatch?secret=YOUR_CRON_SECRET"
```

That endpoint checks each device's timezone and only sends a notification when its local window is active.

## Deployment Notes

- GitHub Pages continues hosting the PWA frontend
- Deploy this backend to any small Node host like Render, Railway, Fly.io, or a VPS
- Make sure the backend environment variables include the VAPID keys, `CRON_SECRET`, and `ALLOWED_ORIGIN`
- The JSON store in `data/store.json` is good for a personal project or prototype
- If you later want multi-user scale, swap the JSON store for SQLite, Postgres, or Supabase
