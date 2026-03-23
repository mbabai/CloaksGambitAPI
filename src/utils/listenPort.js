function listenOnPort(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

async function bindServerPort(server, {
  preferredPort,
  allowFallback = false,
  maxAdditionalPorts = 0,
} = {}) {
  const normalizedPreferredPort = Number(preferredPort);
  const firstPort = Number.isFinite(normalizedPreferredPort) ? normalizedPreferredPort : 0;
  const attempts = allowFallback
    ? Math.max(0, Number(maxAdditionalPorts || 0)) + 1
    : 1;
  let lastError = null;

  for (let offset = 0; offset < attempts; offset += 1) {
    const targetPort = firstPort + offset;
    try {
      const address = await listenOnPort(server, targetPort);
      return {
        address,
        port: Number(address?.port || targetPort),
        usedFallback: offset > 0,
      };
    } catch (err) {
      lastError = err;
      if (!allowFallback || err?.code !== 'EADDRINUSE' || offset === attempts - 1) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Failed to bind server port');
}

module.exports = {
  bindServerPort,
};
