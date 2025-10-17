import { startBotClient } from '../shared/bots';

const SERVER_URL = process.env.BOT_SERVER_URL || 'http://localhost:3000';
const BOT_DIFFICULTY = (process.env.BOT_DIFFICULTY || 'easy').toLowerCase();
const BOT_SECRET = process.env.BOT_SERVICE_SECRET || '';
const POLL_INTERVAL_MS = Number(process.env.BOT_STATUS_INTERVAL ?? '10000');

startBotClient({
  serverUrl: SERVER_URL,
  difficulty: BOT_DIFFICULTY,
  secret: BOT_SECRET,
  heartbeatInterval: POLL_INTERVAL_MS,
}).catch((err) => {
  console.error('Unable to start bot', err);
  process.exit(1);
});
