require('dotenv').config();

const cors = require('cors');
const express = require('express');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const app = express();
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const CRON_SECRET = process.env.CRON_SECRET || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ devices: {} }, null, 2));
  }
}

function loadStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function saveStore(store) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function getRecord(store, deviceId) {
  store.devices[deviceId] = store.devices[deviceId] || {
    deviceId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timezone: 'UTC',
    profileName: 'PETER',
    subscription: null,
    snapshot: {},
    deliveries: {}
  };
  return store.devices[deviceId];
}

function getLocalParts(timezone, date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const values = Object.fromEntries(dtf.formatToParts(date).map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function boolEnabled(value, fallback = true) {
  return typeof value === 'boolean' ? value : fallback;
}

function buildPayload(type, snapshot = {}) {
  const name = snapshot.profileName || 'HUNTER';
  if (type === 'reward_ready') {
    return {
      title: 'Daily Reward Ready',
      body: snapshot.dailyRewardReady
        ? `${name}, your bonus reward is ready for absorption.`
        : 'A reward window has opened in the System.',
      tag: 'reward-ready',
      data: { target: 'reward' }
    };
  }
  if (type === 'decay_warning') {
    const stat = Array.isArray(snapshot.decayRisk) && snapshot.decayRisk[0] ? snapshot.decayRisk[0] : 'dis';
    const labelMap = { str: 'Strength', int: 'Intelligence', vit: 'Vitality', con: 'Control', dis: 'Discipline' };
    return {
      title: 'Decay Warning',
      body: `${labelMap[stat] || 'A stat lane'} is degrading. Train it today to stabilize the System.`,
      tag: `decay-${stat}`,
      data: { target: 'stat', stat }
    };
  }
  if (type === 'boss_ready') {
    return {
      title: 'Raid Action Available',
      body: snapshot.bossDone
        ? 'The weekly raid is already clear.'
        : 'A raid action window is open. Strike while the System is primed.',
      tag: 'boss-ready',
      data: { target: 'boss' }
    };
  }
  if (type === 'remaining_quests') {
    const remaining = Number(snapshot.remainingQuests || snapshot.dailyRemaining || 0);
    return {
      title: 'Evening Closeout',
      body: remaining > 0
        ? `${remaining} gate${remaining === 1 ? '' : 's'} remain open today. Close them before reset.`
        : 'No open gates detected.',
      tag: 'evening-closeout',
      data: { target: 'remaining' }
    };
  }
  return {
    title: 'Daily Quests Active',
    body: snapshot.dailySelected
      ? `${snapshot.dailySelected} daily lanes assigned. ${snapshot.dailyRemaining || 0} still open.`
      : 'The System is waiting for today\'s daily quest assignments.',
    tag: 'daily-briefing',
    data: { target: 'daily_briefing' }
  };
}

function chooseScheduledType(record, date = new Date()) {
  const snapshot = record.snapshot || {};
  const prefs = snapshot.notificationPrefs || {};
  const zone = record.timezone || snapshot.timezone || 'UTC';
  const local = getLocalParts(zone, date);
  const sent = record.deliveries || {};
  const today = local.date;

  if (
    boolEnabled(prefs.reward) &&
    snapshot.dailyRewardReady &&
    sent.reward_ready !== today &&
    local.hour >= 8 &&
    local.hour < 22
  ) return 'reward_ready';

  if (
    boolEnabled(prefs.decay) &&
    Array.isArray(snapshot.decayRisk) &&
    snapshot.decayRisk.length &&
    sent.decay_warning !== today &&
    local.hour >= 11 &&
    local.hour < 19
  ) return 'decay_warning';

  if (
    boolEnabled(prefs.boss) &&
    snapshot.bossActionAvailable &&
    sent.boss_ready !== today &&
    local.hour >= 12 &&
    local.hour < 20
  ) return 'boss_ready';

  if (
    boolEnabled(prefs.morning) &&
    sent.daily_briefing !== today &&
    local.hour >= 6 &&
    local.hour < 11
  ) return 'daily_briefing';

  if (
    boolEnabled(prefs.evening) &&
    Number(snapshot.remainingQuests || snapshot.dailyRemaining || 0) > 0 &&
    sent.remaining_quests !== today &&
    local.hour >= 19 &&
    local.hour < 23
  ) return 'remaining_quests';

  return null;
}

async function sendPush(record, payload) {
  if (!record.subscription || !record.subscription.endpoint) {
    throw new Error('Missing push subscription');
  }
  await webpush.sendNotification(record.subscription, JSON.stringify(payload));
}

async function sendTypeToRecord(record, type) {
  const payload = buildPayload(type, record.snapshot);
  await sendPush(record, payload);
  const today = getLocalParts(record.timezone || 'UTC').date;
  record.deliveries[type] = today;
  record.updatedAt = new Date().toISOString();
  return payload;
}

function mergeSnapshot(record, body = {}) {
  record.timezone = body.timezone || record.timezone || 'UTC';
  record.profileName = body.profileName || record.profileName || 'PETER';
  record.snapshot = {
    ...(record.snapshot || {}),
    ...body,
    timezone: body.timezone || record.timezone || 'UTC',
    profileName: body.profileName || record.profileName || 'PETER'
  };
  record.updatedAt = new Date().toISOString();
}

function pruneExpiredSubscription(error, store, deviceId) {
  if (!error || !error.statusCode) return false;
  if (error.statusCode !== 404 && error.statusCode !== 410) return false;
  delete store.devices[deviceId];
  return true;
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    vapidReady: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT),
    devices: Object.keys(loadStore().devices).length
  });
});

app.post('/api/notifications/subscribe', (req, res) => {
  const { deviceId, subscription, timezone, profileName, snapshot } = req.body || {};
  if (!deviceId || !subscription || !subscription.endpoint) {
    return res.status(400).json({ ok: false, error: 'deviceId and subscription are required' });
  }
  const store = loadStore();
  const record = getRecord(store, deviceId);
  record.subscription = subscription;
  mergeSnapshot(record, {
    ...(snapshot || {}),
    timezone: timezone || (snapshot || {}).timezone,
    profileName: profileName || (snapshot || {}).profileName
  });
  saveStore(store);
  res.json({ ok: true, deviceId, stored: true });
});

app.post('/api/notifications/state', (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'deviceId is required' });
  }
  const store = loadStore();
  const record = getRecord(store, deviceId);
  mergeSnapshot(record, req.body || {});
  saveStore(store);
  res.json({ ok: true, deviceId, syncedAt: record.updatedAt });
});

app.post('/api/notifications/test', async (req, res) => {
  const { deviceId, type = 'daily_briefing', payload } = req.body || {};
  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'deviceId is required' });
  }

  const store = loadStore();
  const record = store.devices[deviceId];
  if (!record) {
    return res.status(404).json({ ok: false, error: 'device not registered' });
  }

  try {
    const message = payload || buildPayload(type, record.snapshot);
    await sendPush(record, message);
    record.updatedAt = new Date().toISOString();
    saveStore(store);
    res.json({ ok: true, type, title: message.title });
  } catch (error) {
    const removed = pruneExpiredSubscription(error, store, deviceId);
    if (removed) saveStore(store);
    res.status(500).json({ ok: false, error: error.message, pruned: removed });
  }
});

app.post('/api/notifications/dispatch', async (req, res) => {
  if (CRON_SECRET) {
    const supplied = req.headers['x-cron-secret'] || req.query.secret || (req.body || {}).secret;
    if (supplied !== CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'invalid cron secret' });
    }
  }

  const store = loadStore();
  const entries = Object.entries(store.devices);
  let sent = 0;
  let skipped = 0;
  const results = [];

  for (const [deviceId, record] of entries) {
    const type = chooseScheduledType(record);
    if (!type) {
      skipped += 1;
      continue;
    }
    try {
      const payload = await sendTypeToRecord(record, type);
      sent += 1;
      results.push({ deviceId, type, title: payload.title });
    } catch (error) {
      const removed = pruneExpiredSubscription(error, store, deviceId);
      results.push({ deviceId, type, error: error.message, pruned: removed });
    }
  }

  saveStore(store);
  res.json({ ok: true, sent, skipped, devices: entries.length, results });
});

app.listen(PORT, () => {
  console.log(`SL notification backend listening on http://localhost:${PORT}`);
});
