// orderEventManager.js
const WebSocket = require('ws');

// In-memory store for connected clients (you can replace with Redis for scalability)
const clients = new Map();

const broadcastEvent = (event, data) => {
  const message = JSON.stringify({ event, data });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

const broadcastOrderUpdate = (data) => {
  broadcastEvent('order_update', data);
};

const initializeWebSocket = (server) => {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    const clientId = req.headers['sec-websocket-key'] || Date.now().toString();
    clients.set(clientId, ws);

    ws.on('close', () => {
      clients.delete(clientId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
      clients.delete(clientId);
    });
  });

  console.log('WebSocket server initialized');
};

module.exports = {
  broadcastEvent,
  broadcastOrderUpdate,
  initializeWebSocket,
};