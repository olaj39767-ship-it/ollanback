const mongoose = require('mongoose');

const pendingOrderSchema = new mongoose.Schema({
  orderId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  orderData: { 
    type: Object, 
    required: true 
  },
  cart: { 
    type: Array, 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'expired', 'failed'],
    default: 'pending',
    index: true
  },
  transactionId: { 
    type: String 
  },
  completedAt: { 
    type: Date 
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    expires: 3600 // Auto-delete after 1 hour (TTL index)
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Update updatedAt on save
pendingOrderSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Index for faster queries
pendingOrderSchema.index({ createdAt: -1 });
pendingOrderSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('PendingOrder', pendingOrderSchema);