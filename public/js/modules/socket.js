export function wireSocket(socket, handlers) {
  const {
    onConnect,
    onInitialState,
    onQueueUpdate,
    onGameUpdate,
    onGameFinished,
    onBothReady,
    onDisconnect
  } = handlers;

  socket.on('connect', () => { try { onConnect && onConnect(); } catch (_) {} });
  socket.on('initialState', async (payload) => { try { await onInitialState?.(payload); } catch (_) {} });
  socket.on('queue:update', (payload) => { try { onQueueUpdate && onQueueUpdate(payload); } catch (_) {} });
  socket.on('game:update', (payload) => { try { onGameUpdate && onGameUpdate(payload); } catch (_) {} });
  socket.on('game:finished', (payload) => { try { onGameFinished && onGameFinished(payload); } catch (_) {} });
  socket.on('players:bothReady', async (payload) => { try { await onBothReady?.(payload); } catch (_) {} });
  socket.on('disconnect', () => { try { onDisconnect && onDisconnect(); } catch (_) {} });
}


