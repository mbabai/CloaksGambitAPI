const {
  getWebhookUrl,
  getQueueTransitions,
  notifyLobbyJoined,
  notifyLobbyLeft,
  notifyQueueTransitions,
  LOBBY_JOIN_NOTIFICATION_COOLDOWN_MS,
  sendDiscordMessage,
} = require('../src/services/discordLobbyWebhook');

function createUserModel(usersById = {}) {
  return {
    findById: jest.fn((id) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn(async () => usersById[id] || null),
    })),
  };
}

describe('discord lobby webhook service', () => {
  const originalDiscordLobbyWebhookUrl = process.env.DISCORD_LOBBY_WEBHOOK_URL;
  const originalAzureDiscordLobbyWebhookUrl = process.env.DiscordLobbyWebhookURL;

  afterEach(() => {
    if (originalDiscordLobbyWebhookUrl === undefined) {
      delete process.env.DISCORD_LOBBY_WEBHOOK_URL;
    } else {
      process.env.DISCORD_LOBBY_WEBHOOK_URL = originalDiscordLobbyWebhookUrl;
    }
    if (originalAzureDiscordLobbyWebhookUrl === undefined) {
      delete process.env.DiscordLobbyWebhookURL;
    } else {
      process.env.DiscordLobbyWebhookURL = originalAzureDiscordLobbyWebhookUrl;
    }
  });

  test('reads Azure-style Discord webhook environment variable names', () => {
    delete process.env.DISCORD_LOBBY_WEBHOOK_URL;
    process.env.DiscordLobbyWebhookURL = 'https://discord.test/from-key-vault';

    expect(getWebhookUrl()).toBe('https://discord.test/from-key-vault');
  });

  test('posts Discord messages as webhook JSON', async () => {
    const fetchFn = jest.fn(async () => ({ ok: true }));

    const result = await sendDiscordMessage('Ada has joined the lobby', {
      webhookUrl: 'https://discord.test/webhook',
      fetchFn,
    });

    expect(result).toEqual({ sent: true });
    expect(fetchFn).toHaveBeenCalledWith('https://discord.test/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'Ada has joined the lobby' }),
    });
  });

  test('skips sending when no webhook URL is configured', async () => {
    const fetchFn = jest.fn();

    const result = await sendDiscordMessage('Ada has joined the lobby', {
      webhookUrl: '',
      fetchFn,
    });

    expect(result).toEqual({ sent: false, reason: 'missing-webhook-url' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('formats lobby join notifications and disables lobby leave notifications', async () => {
    const sendMessageFn = jest.fn(async () => ({ sent: true }));

    await notifyLobbyJoined({ userId: 'u1', username: 'Ada' }, { sendMessageFn });
    const leaveResult = await notifyLobbyLeft({ userId: 'u1', username: 'Ada' }, { sendMessageFn });

    expect(sendMessageFn).toHaveBeenCalledTimes(1);
    expect(sendMessageFn).toHaveBeenCalledWith(
      'Ada has joined the lobby',
      expect.objectContaining({ sendMessageFn }),
    );
    expect(leaveResult).toEqual({ sent: false, reason: 'lobby-leave-disabled' });
  });

  test('suppresses duplicate lobby join notifications for the same account for 30 minutes', async () => {
    const sendMessageFn = jest.fn(async () => ({ sent: true }));
    const notificationTimes = new Map();

    const first = await notifyLobbyJoined(
      { userId: 'u1', username: 'Ada' },
      { sendMessageFn, notificationTimes, nowFn: () => 1_000 },
    );
    const second = await notifyLobbyJoined(
      { userId: 'u1', username: 'Ada' },
      { sendMessageFn, notificationTimes, nowFn: () => 1_000 + LOBBY_JOIN_NOTIFICATION_COOLDOWN_MS - 1 },
    );
    const third = await notifyLobbyJoined(
      { userId: 'u1', username: 'Ada' },
      { sendMessageFn, notificationTimes, nowFn: () => 1_000 + LOBBY_JOIN_NOTIFICATION_COOLDOWN_MS },
    );

    expect(first).toEqual({ sent: true });
    expect(second).toEqual({ sent: false, reason: 'join-cooldown' });
    expect(third).toEqual({ sent: true });
    expect(sendMessageFn).toHaveBeenCalledTimes(2);
    expect(sendMessageFn).toHaveBeenNthCalledWith(
      1,
      'Ada has joined the lobby',
      expect.objectContaining({ sendMessageFn }),
    );
    expect(sendMessageFn).toHaveBeenNthCalledWith(
      2,
      'Ada has joined the lobby',
      expect.objectContaining({ sendMessageFn }),
    );
  });

  test('does not start lobby join cooldown until a notification is sent', async () => {
    const sendMessageFn = jest.fn()
      .mockResolvedValueOnce({ sent: false, reason: 'missing-webhook-url' })
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: false, reason: 'join-cooldown' });
    const notificationTimes = new Map();

    const first = await notifyLobbyJoined(
      { userId: 'guest-1', username: 'Anonymous1' },
      { sendMessageFn, notificationTimes, nowFn: () => 1_000 },
    );
    const second = await notifyLobbyJoined(
      { userId: 'guest-1', username: 'Anonymous1' },
      { sendMessageFn, notificationTimes, nowFn: () => 2_000 },
    );
    const third = await notifyLobbyJoined(
      { userId: 'guest-1', username: 'Anonymous1' },
      { sendMessageFn, notificationTimes, nowFn: () => 3_000 },
    );

    expect(first).toEqual({ sent: false, reason: 'missing-webhook-url' });
    expect(second).toEqual({ sent: true });
    expect(third).toEqual({ sent: false, reason: 'join-cooldown' });
    expect(sendMessageFn).toHaveBeenCalledTimes(2);
    expect(sendMessageFn).toHaveBeenNthCalledWith(
      1,
      'Anonymous1 has joined the lobby',
      expect.objectContaining({ sendMessageFn }),
    );
    expect(sendMessageFn).toHaveBeenNthCalledWith(
      2,
      'Anonymous1 has joined the lobby',
      expect.objectContaining({ sendMessageFn }),
    );
  });

  test('detects queue joins and leaves per queue name', () => {
    const transitions = getQueueTransitions(
      {
        quickplayQueue: ['u1'],
        rankedQueue: ['u2'],
        botQueue: [],
      },
      {
        quickplayQueue: ['u3'],
        rankedQueue: [],
        botQueue: ['u4'],
      },
    );

    expect(transitions).toEqual([
      { userId: 'u3', queueName: 'quickplay queue', action: 'joined' },
      { userId: 'u1', queueName: 'quickplay queue', action: 'left' },
      { userId: 'u2', queueName: 'ranked queue', action: 'left' },
      { userId: 'u4', queueName: 'bot queue', action: 'joined' },
    ]);
  });

  test('sends queue notifications with resolved usernames', async () => {
    const UserModel = createUserModel({
      u1: { username: 'Ada' },
      u2: { username: 'Grace' },
    });
    const sendMessageFn = jest.fn(async () => ({ sent: true }));

    await notifyQueueTransitions(
      {
        quickplayQueue: ['u1'],
        rankedQueue: [],
        botQueue: [],
      },
      {
        quickplayQueue: [],
        rankedQueue: ['u2'],
        botQueue: [],
      },
      {
        UserModel,
        sendMessageFn,
      },
    );

    expect(sendMessageFn).toHaveBeenCalledTimes(2);
    expect(sendMessageFn).toHaveBeenNthCalledWith(
      1,
      'Ada has left the quickplay queue',
      expect.objectContaining({ sendMessageFn }),
    );
    expect(sendMessageFn).toHaveBeenNthCalledWith(
      2,
      'Grace has joined the ranked queue',
      expect.objectContaining({ sendMessageFn }),
    );
  });

  test('limits queue notifications to affected users when provided', async () => {
    const UserModel = createUserModel({
      u1: { username: 'Ada' },
      u2: { username: 'Grace' },
    });
    const sendMessageFn = jest.fn(async () => ({ sent: true }));

    await notifyQueueTransitions(
      {
        quickplayQueue: ['u1', 'u2'],
        rankedQueue: [],
        botQueue: [],
      },
      {
        quickplayQueue: [],
        rankedQueue: [],
        botQueue: [],
      },
      {
        affectedUsers: ['u2'],
        UserModel,
        sendMessageFn,
      },
    );

    expect(sendMessageFn).toHaveBeenCalledTimes(1);
    expect(sendMessageFn).toHaveBeenCalledWith(
      'Grace has left the quickplay queue',
      expect.objectContaining({ sendMessageFn }),
    );
  });
});
