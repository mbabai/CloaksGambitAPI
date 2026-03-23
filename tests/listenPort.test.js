const http = require('http');

const { bindServerPort } = require('../src/utils/listenPort');

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

describe('bindServerPort', () => {
  test('falls back to the next available port when the preferred local port is busy', async () => {
    const blocker = http.createServer((req, res) => res.end('busy'));
    await new Promise((resolve) => blocker.listen(0, resolve));
    const blockerPort = Number(blocker.address().port);

    const server = http.createServer((req, res) => res.end('ok'));
    const result = await bindServerPort(server, {
      preferredPort: blockerPort,
      allowFallback: true,
      maxAdditionalPorts: 10,
    });

    expect(result.port).not.toBe(blockerPort);
    expect(result.usedFallback).toBe(true);

    await closeServer(server);
    await closeServer(blocker);
  });

  test('throws the original EADDRINUSE error when fallback is disabled', async () => {
    const blocker = http.createServer((req, res) => res.end('busy'));
    await new Promise((resolve) => blocker.listen(0, resolve));
    const blockerPort = Number(blocker.address().port);

    const server = http.createServer((req, res) => res.end('ok'));
    await expect(bindServerPort(server, {
      preferredPort: blockerPort,
      allowFallback: false,
    })).rejects.toMatchObject({ code: 'EADDRINUSE' });

    await closeServer(blocker);
  });
});
