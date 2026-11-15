// The local WebSocket server shared by the live bridge and the replay tool.

import { WebSocketServer } from 'ws';

export const DEFAULT_PORT = 8765;

export function bridgePort() {
  const port = Number(process.env.BOWLBANK_BRIDGE_PORT);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
}

export function emptyStatus(source) {
  return {
    type: 'status',
    source,
    connected: false,
    device: null,
    sensors: { buttons: false, accel: false, gyro: false, ir: false },
    message: '',
  };
}

// Start the server. It only listens on 127.0.0.1, so nothing off this laptop can reach it.
export function startServer({ port = bridgePort(), source = 'wii', onMessage = () => {}, onClient = () => {} } = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port });
  let status = emptyStatus(source);
  let lastLine = '';

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  wss.on('connection', (ws) => {
    send(ws, status);
    ws.on('message', (data) => {
      try {
        onMessage(JSON.parse(data.toString()), ws);
      } catch {
        // A message that is not JSON is ignored.
      }
    });
    ws.on('error', () => {});
    onClient(ws);
  });

  return {
    wss,
    port,
    ready: new Promise((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    }),
    clientCount: () => wss.clients.size,
    broadcast(msg) {
      if (wss.clients.size === 0) return;
      const text = JSON.stringify(msg);
      for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(text);
    },
    getStatus: () => status,
    // Update the status. It is sent and printed only when something changed.
    setStatus(patch) {
      const next = { ...status, ...patch, sensors: { ...status.sensors, ...(patch.sensors || {}) } };
      if (JSON.stringify(next) === JSON.stringify(status)) return;
      status = next;
      this.broadcast(status);
      const s = status.sensors;
      const flags = ['buttons', 'accel', 'gyro', 'ir'].map((k) => `${k}:${s[k] ? 'yes' : 'no'}`).join(' ');
      const line = `[${status.source}] ${status.connected ? 'connected' : 'not connected'} | ${flags} | ${status.message}`;
      if (line !== lastLine) {
        lastLine = line;
        console.log(line);
      }
    },
    close: () => new Promise((resolve) => {
      for (const ws of wss.clients) ws.terminate();
      wss.close(() => resolve());
    }),
  };
}
