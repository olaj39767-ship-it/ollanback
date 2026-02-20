// Create a new file: src/events/orderEvents.js
const EventEmitter = require('events');
const logger = require('../config/logger');

class OrderEventManager extends EventEmitter {
  constructor() {
    super();
    this.activeConnections = new Map();
    this.setMaxListeners(100); // Increase max listeners
  }

  // Add SSE connection
  addConnection(connectionId, res, userId) {
    this.activeConnections.set(connectionId, {
      res,
      userId,
      connectedAt: new Date()
    });
    
    logger.info(`SSE connection added: ${connectionId} for user: ${userId}`);
  }

  // Remove SSE connection
  removeConnection(connectionId) {
    const connection = this.activeConnections.get(connectionId);
    if (connection) {
      this.activeConnections.delete(connectionId);
      logger.info(`SSE connection removed: ${connectionId}`);
    }
  }

  // Broadcast order update to all admin connections
  broadcastOrderUpdate(orderData) {
    const message = JSON.stringify({
      type: 'order_update',
      data: orderData,
      timestamp: new Date().toISOString()
    });

    this.activeConnections.forEach((connection, connectionId) => {
      try {
        if (!connection.res.destroyed) {
          connection.res.write(`data: ${message}\n\n`);
        } else {
          // Clean up destroyed connections
          this.removeConnection(connectionId);
        }
      } catch (error) {
        logger.error(`Error broadcasting to connection ${connectionId}: ${error.message}`);
        this.removeConnection(connectionId);
      }
    });

    logger.info(`Order update broadcasted to ${this.activeConnections.size} connections`);
  }

  // Broadcast specific event
  broadcastEvent(eventType, data) {
    const message = JSON.stringify({
      type: eventType,
      data,
      timestamp: new Date().toISOString()
    });

    this.activeConnections.forEach((connection, connectionId) => {
      try {
        if (!connection.res.destroyed) {
          connection.res.write(`data: ${message}\n\n`);
        } else {
          this.removeConnection(connectionId);
        }
      } catch (error) {
        logger.error(`Error broadcasting event ${eventType} to ${connectionId}: ${error.message}`);
        this.removeConnection(connectionId);
      }
    });
  }

  // Get connection stats
  getStats() {
    return {
      activeConnections: this.activeConnections.size,
      connections: Array.from(this.activeConnections.entries()).map(([id, conn]) => ({
        id,
        userId: conn.userId,
        connectedAt: conn.connectedAt
      }))
    };
  }

  // Cleanup all connections
  cleanup() {
    this.activeConnections.forEach((connection, connectionId) => {
      try {
        if (!connection.res.destroyed) {
          connection.res.end();
        }
      } catch (error) {
        logger.error(`Error cleaning up connection ${connectionId}: ${error.message}`);
      }
    });
    this.activeConnections.clear();
    this.removeAllListeners();
  }
}

// Create singleton instance
const orderEventManager = new OrderEventManager();

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Cleaning up order event manager...');
  orderEventManager.cleanup();
});

process.on('SIGTERM', () => {
  logger.info('Cleaning up order event manager...');
  orderEventManager.cleanup();
});

module.exports = orderEventManager;