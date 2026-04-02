const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null for guests
  isGuest: { type: Boolean, default: false },
  guestIp: { type: String, default: null },
  items: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
      quantity: { type: Number, required: true },
      price: { type: Number, required: true },
      name: { type: String },
    },
  ],
  customerInfo: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    deliveryOption: { type: String },
    deliveryAddress: { type: String, default: null },
    pickupLocation: { type: String, default: null },
    timeSlot: { type: String, default: null },
    estimatedDelivery: { type: String },
    transactionNumber: { type: String },
  },
  deliveryFee: { type: Number, default: 0 },
  subtotal: { type: Number },
  prescriptionUrl: { type: String },
  totalAmount: { type: Number, required: true },
  paymentDetails: { type: String, default: '' },
  paymentReference: { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'processing', 'accepted', 'rejected', 'cancelled'],
    default: 'pending',
  },
  deliveryStatus: {
    type: String,
    enum: ['pending', 'en_route', 'delivered'],
    default: 'pending',
  },
  referralCodeUsed: {
    type: String,
    trim: true,
    uppercase: true,
    default: null,
    index: true,
  },
  rider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  riderName: { type: String },
  trackingLinkShared: { type: Boolean, default: false },
  trackingLinkSharedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Order', orderSchema);