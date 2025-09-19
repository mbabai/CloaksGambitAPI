export function wireSocket(socket, handlers) {
  const {
    onConnect,
    onInitialState,
    onQueueUpdate,
    onGameUpdate,
    onGameFinished,
    onNextCountdown,
    onBothNext,
    onBothReady,
    onDisconnect,
    onConnectionStatus,
    onInviteRequest,
    onInviteResult,
    onInviteCancel
  } = handlers;

  socket.on('connect', () => { try { onConnect && onConnect(); } catch (_) {} });
  socket.on('initialState', async (payload) => { try { await onInitialState?.(payload); } catch (_) {} });
  socket.on('queue:update', (payload) => { try { onQueueUpdate && onQueueUpdate(payload); } catch (_) {} });
  socket.on('game:update', (payload) => { try { onGameUpdate && onGameUpdate(payload); } catch (_) {} });
  socket.on('game:finished', (payload) => { try { onGameFinished && onGameFinished(payload); } catch (_) {} });
  socket.on('next:countdown', async (payload) => { try { await onNextCountdown?.(payload); } catch (_) {} });
  socket.on('players:bothNext', async (payload) => { try { await onBothNext?.(payload); } catch (_) {} });
  socket.on('players:bothReady', async (payload) => { try { await onBothReady?.(payload); } catch (_) {} });
  socket.on('match:connectionStatus', async (payload) => { try { await onConnectionStatus?.(payload); } catch (_) {} });
  socket.on('custom:inviteRequest', (payload) => { try { onInviteRequest && onInviteRequest(payload); } catch (_) {} });
  socket.on('custom:inviteResult', (payload) => { try { onInviteResult && onInviteResult(payload); } catch (_) {} });
  socket.on('custom:inviteCancel', (payload) => { try { onInviteCancel && onInviteCancel(payload); } catch (_) {} });
  socket.on('disconnect', () => { try { onDisconnect && onDisconnect(); } catch (_) {} });
}


