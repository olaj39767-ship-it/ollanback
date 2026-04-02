// utils/cleanupPendingOrders.js
const Order = require('../models/Order');
const Product = require('../models/Product');
const logger = require('../config/logger');

const EXPIRY_MINUTES = 30;

async function cleanupExpiredPendingOrders() {
  const cutoff = new Date(Date.now() - EXPIRY_MINUTES * 60 * 1000);

  const expired = await Order.find({
    status: 'pending',
    createdAt: { $lt: cutoff },
  });

  for (const order of expired) {
    // Restore stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: item.quantity },
      });
    }
    order.status = 'expired';
    await order.save();
    logger.info(`Expired pending order cleaned up: ${order._id}`);
  }
}

// Run every 15 minutes
setInterval(cleanupExpiredPendingOrders, 15 * 60 * 1000);

module.exports = cleanupExpiredPendingOrders;