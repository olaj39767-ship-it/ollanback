const axios = require('axios');

const WEBSOCKET_SERVER_URL = process.env.WEBSOCKET_SERVER_URL || 'https://ollan-websocket.fly.dev';

const broadcastEvent = async (event, data) => {
  try {
    await axios.post(`${WEBSOCKET_SERVER_URL}/broadcast`, { event, data });
  } catch (error) {
    console.error(`Failed to broadcast event to WebSocket server: ${error.message}`);
  }
};

const broadcastOrderUpdate = async (data) => {
  await broadcastEvent('order_update', data);
};

module.exports = {
  broadcastEvent,
  broadcastOrderUpdate,
};