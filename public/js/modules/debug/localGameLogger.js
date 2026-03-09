export function createLocalGameLogger({
  enabled = false,
  source = 'player-client',
  sender = null,
} = {}) {
  let sequence = 0;

  return function logLocalGameEvent(event, payload = {}) {
    if (!enabled || typeof sender !== 'function') {
      return;
    }

    sequence += 1;
    const body = {
      source,
      event,
      gameId: payload?.gameId || null,
      payload: {
        sequence,
        ...payload,
      },
    };

    Promise.resolve(sender(body)).catch(() => {});
  };
}
