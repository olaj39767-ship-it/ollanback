const orderEventManager = require('../events/orderEvents');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const User = require('../models/User');
const ReferralCode = require('../models/ReferralCode'); // ← add this import
const emailService = require('../config/emailService');
const formidable = require('formidable');
const fs = require('fs/promises');
const logger = require('../config/logger');

// ─── Valid promo / referral codes ───────────────────────────────────────────
// Single source of truth. Add or remove codes here; the seeder below will
// sync them to the DB so stats are always tracked against real documents.
const VALID_REFERRAL_CODES = ['MZ10', 'OY10', 'EM10', 'TL10', 'BSP10'];

/**
 * Call once at server startup (e.g. in app.js after DB connect) to ensure
 * every valid code has a ReferralCode document in the database.
 *
 *   const { seedReferralCodes } = require('./controllers/orderController');
 *   seedReferralCodes();
 */
const seedReferralCodes = async () => {
  try {
    for (const code of VALID_REFERRAL_CODES) {
      await ReferralCode.findOneAndUpdate(
        { code },
        { $setOnInsert: { code, totalUses: 0, verifiedPurchases: 0, isActive: true } },
        { upsert: true, new: true }
      );
    }
    logger.info(`Referral codes seeded: ${VALID_REFERRAL_CODES.join(', ')}`);
  } catch (err) {
    logger.error(`Failed to seed referral codes: ${err.message}`);
  }
};

// ─── In-memory cache ─────────────────────────────────────────────────────────
const adminOrdersCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

const getCachedAdminOrders = (adminId) => {
  const cached = adminOrdersCache.get(adminId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
  adminOrdersCache.delete(adminId);
  return null;
};

const setCachedAdminOrders = (adminId, data) => {
  adminOrdersCache.set(adminId, { data, timestamp: Date.now() });
};

const invalidateAdminOrdersCache = (adminId = null) => {
  adminId ? adminOrdersCache.delete(adminId) : adminOrdersCache.clear();
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function sendOrderNotification(order, status, additionalInfo = '') {
  try {
    const { email, name } = order.customerInfo;
    const orderId = order._id.toString().slice(-6);
    await emailService.sendOrderStatusUpdate(email, name, orderId, status, additionalInfo);
  } catch (error) {
    logger.error(`Email notification failed for order ${order._id}: ${error.message}`);
  }
}

// ─── sendPrescription ────────────────────────────────────────────────────────
exports.sendPrescription = async (req, res) => {
  try {
    const form = new formidable.IncomingForm({ multiples: true });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) { logger.error(`Form parsing error: ${err.message}`); reject(err); }
        resolve({ fields, files });
      });
    });

    const { name, email, phone, location } = fields;
    if (!name || !email || !phone || !location) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    const fileArray = Array.isArray(files.files) ? files.files : files.files ? [files.files] : [];
    if (fileArray.length === 0) return res.status(400).json({ message: 'At least one file must be uploaded' });

    const allowedTypes = [
      'image/jpeg', 'image/png', 'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const invalidFiles = fileArray.filter((f) => !allowedTypes.includes(f.mimetype));
    if (invalidFiles.length > 0) return res.status(400).json({ message: 'Only JPEG, PNG, PDF, DOC, DOCX files are allowed' });

    const attachments = await Promise.all(
      fileArray.map(async (file) => ({ filename: file.originalFilename, content: await fs.readFile(file.filepath) }))
    );

    await emailService.sendTextEmail(
      process.env.EMAIL_USER,
      `New Prescription Upload from ${name}`,
      `New Prescription Submission:\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nLocation: ${location}\nFiles: ${fileArray.map((f) => f.originalFilename).join(', ')}`,
      { attachments }
    );

    await Promise.all(fileArray.map((f) => fs.unlink(f.filepath)));

    orderEventManager.broadcastEvent('prescription_submitted', {
      name, email, phone, location,
      files: fileArray.map((f) => f.originalFilename),
      timestamp: new Date().toISOString(),
    });

    logger.info(`Prescription submitted for ${name} (${email})`);
    res.status(200).json({ message: 'Prescription uploaded and email sent successfully' });
  } catch (error) {
    logger.error(`Send prescription error: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── createOrder ─────────────────────────────────────────────────────────────
exports.createOrder = async (req, res) => {
  const user = req.user; // may be undefined → guest

  const {
    customerInfo,
    items: cartItems,
    prescriptionUrl = '',
    referralCode,
  } = req.body;

  try {
    // ── Validation ──────────────────────────────────────────
    if (
      !customerInfo ||
      !customerInfo.name?.trim() ||
      !customerInfo.email?.trim() ||
      !customerInfo.phone?.trim() ||
      !customerInfo.transactionNumber?.trim() ||
      !customerInfo.deliveryOption
    ) {
      return res.status(400).json({ message: 'Missing or invalid customer information' });
    }

    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    const txNumber = customerInfo.transactionNumber.trim();
    if (txNumber.length < 6) {
      return res.status(400).json({ message: 'Transaction number too short' });
    }

    // ── Referral code validation ────────────────────────────
    let normalizedReferral = null;
    if (referralCode && referralCode.trim()) {
      normalizedReferral = referralCode.trim().toUpperCase();

      if (!VALID_REFERRAL_CODES.includes(normalizedReferral)) {
        return res.status(400).json({ message: `Invalid referral code: ${referralCode}` });
      }
    }

    const normalizedEmail = customerInfo.email.trim().toLowerCase();

    // ── Stock deduction & subtotal ──────────────────────────
    let subtotal = 0;
    const validatedItems = [];

    for (const item of cartItems) {
      const product = await Product.findById(item.productId);
      if (!product) return res.status(400).json({ message: `Product not found: ${item.productId}` });

      if (product.stock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.name} (only ${product.stock} left)`,
        });
      }

      product.stock -= item.quantity;
      await product.save();

      subtotal += product.price * item.quantity;
      validatedItems.push({ productId: product._id, quantity: item.quantity, price: product.price, name: product.name });
    }

    // ── Delivery fee ────────────────────────────────────────
    let deliveryFee = 0;
    const option = customerInfo.deliveryOption.toLowerCase();
    if (option === 'express') deliveryFee = 0;
    else if (option === 'timeframe') deliveryFee = subtotal < 5000 ? 500 : 0;
    else if (option === 'pickup') deliveryFee = 0;
    else return res.status(400).json({ message: 'Invalid delivery option' });

    const totalAmount = subtotal + deliveryFee;

    // ── Persist order ───────────────────────────────────────
    const order = new Order({
      user: user ? user._id : null,
      isGuest: !user,
      guestIp: !user ? req.ip : undefined,
      items: validatedItems,
      customerInfo: {
        name: customerInfo.name.trim(),
        email: normalizedEmail,
        phone: customerInfo.phone.trim(),
        deliveryOption: customerInfo.deliveryOption,
        deliveryAddress: customerInfo.deliveryAddress?.trim() || null,
        pickupLocation: customerInfo.pickupLocation?.trim() || null,
        timeSlot: customerInfo.timeSlot?.trim() || null,
        transactionNumber: txNumber,
        estimatedDelivery: customerInfo.estimatedDelivery || 'Pending confirmation',
      },
      deliveryFee,
      subtotal,
      referralCodeUsed: normalizedReferral, // stored as uppercase, e.g. "MZ10"
      totalAmount,
      prescriptionUrl,
      paymentReference: `OLLAN_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
      status: 'pending',
    });

    const savedOrder = await order.save();

    // ── Increment totalUses on the referral code doc ────────
    if (normalizedReferral) {
      await ReferralCode.findOneAndUpdate(
        { code: normalizedReferral },
        { $inc: { totalUses: 1 } }
      );
      logger.info(`Referral code ${normalizedReferral} totalUses incremented`);
    }

    // ── Events & notifications ──────────────────────────────
    orderEventManager.broadcastOrderUpdate({
      type: 'new_order',
      order: savedOrder,
      message: `New order #${savedOrder._id.toString().slice(-6)} created by ${customerInfo.name} (${user ? 'registered' : 'guest'})`,
    });

    invalidateAdminOrdersCache();
    await sendOrderNotification(savedOrder, 'pending');

    logger.info(`Order created → ${user ? `user:${user._id}` : `guest:${normalizedEmail}`} – ID: ${savedOrder._id}`);

    return res.status(201).json({
      message: 'Order created successfully',
      order: savedOrder,
      suggestRegistration: !user && savedOrder.customerInfo.email,
    });
  } catch (error) {
    logger.error(`Create order error: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── verifyPayment ───────────────────────────────────────────────────────────
exports.verifyPayment = async (req, res) => {
  const { orderId, paymentDetails } = req.body;
  const adminId = req.user?._id;

  try {
    if (!orderId) return res.status(400).json({ message: 'Order ID is required' });
    if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Only admins can verify payments' });

    const order = await Order.findById(orderId).populate('items.productId user');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'pending') return res.status(400).json({ message: `Order already ${order.status}` });

    order.status = 'processing';
    order.paymentDetails = paymentDetails || 'Manually verified by seller';
    order.paymentReference = order.paymentReference || `MANUAL_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    const updatedOrder = await order.save();

    // Increment verifiedPurchases on the referral code doc
    if (updatedOrder.referralCodeUsed) {
      const ref = await ReferralCode.findOneAndUpdate(
        { code: updatedOrder.referralCodeUsed },
        { $inc: { verifiedPurchases: 1 }, $set: { updatedAt: new Date() } },
        { new: true }
      );
      if (ref) {
        logger.info(`Referral code ${ref.code} verifiedPurchases → ${ref.verifiedPurchases}`);
      } else {
        logger.warn(`Referral code ${updatedOrder.referralCodeUsed} not found in DB during payment verification`);
      }
    }

    orderEventManager.broadcastOrderUpdate({
      type: 'payment_verified',
      order: updatedOrder,
      message: `Payment verified for order #${orderId.slice(-6)}`,
    });

    invalidateAdminOrdersCache();
    await sendOrderNotification(updatedOrder, 'processing', paymentDetails);

    logger.info(`Payment verified for order ${orderId} by admin ${adminId}`);
    res.json({ message: 'Payment verified', order: updatedOrder });
  } catch (error) {
    logger.error(`Payment verification error: ${error.message}`, { orderId });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── getReferralStats  (admin only) ─────────────────────────────────────────
/**
 * GET /api/orders/referral-stats
 * Returns usage stats for every referral code.
 *
 * Response shape:
 * {
 *   "stats": [
 *     {
 *       "code": "MZ10",
 *       "totalUses": 12,          // submitted at checkout (pending or not)
 *       "verifiedPurchases": 9,   // payment actually verified by admin
 *       "pendingVerification": 3, // totalUses - verifiedPurchases
 *       "isActive": true,
 *       "lastUpdated": "2025-..."
 *     },
 *     ...
 *   ],
 *   "totals": {
 *     "totalUses": 30,
 *     "verifiedPurchases": 22
 *   }
 * }
 */
exports.getReferralStats = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can view referral stats' });
    }

    const codes = await ReferralCode.find().sort({ totalUses: -1 }).lean();

    const stats = codes.map((c) => ({
      code: c.code,
      totalUses: c.totalUses,
      verifiedPurchases: c.verifiedPurchases,
      pendingVerification: c.totalUses - c.verifiedPurchases,
      isActive: c.isActive,
      lastUpdated: c.updatedAt,
    }));

    const totals = stats.reduce(
      (acc, c) => {
        acc.totalUses += c.totalUses;
        acc.verifiedPurchases += c.verifiedPurchases;
        return acc;
      },
      { totalUses: 0, verifiedPurchases: 0 }
    );

    logger.info(`Referral stats fetched by admin ${req.user._id}`);
    res.json({ stats, totals });
  } catch (error) {
    logger.error(`Get referral stats error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── uploadPrescription ──────────────────────────────────────────────────────
exports.uploadPrescription = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    res.json({ prescriptionUrl: `/uploads/${req.file.filename}` });
  } catch (error) {
    logger.error(`Upload prescription error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── getUserOrders ───────────────────────────────────────────────────────────
exports.getUserOrders = async (req, res) => {
  const user = req.user;
  const { email } = req.query;

  try {
    const searchEmail = user ? user.email : (email || '').trim().toLowerCase();
    if (!searchEmail) return res.status(400).json({ message: 'Email required for guest lookup' });

    const orders = await Order.find({ 'customerInfo.email': searchEmail })
      .populate('items.productId')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    logger.error(`Get orders error: ${error.message}`);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── getAllOrders ────────────────────────────────────────────────────────────
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find().populate('user items.productId');
    logger.info(`All orders retrieved, count: ${orders.length}`);
    res.json(orders);
  } catch (error) {
    logger.error(`Get all orders error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── getAdminOrders ──────────────────────────────────────────────────────────
exports.getAdminOrders = async (req, res) => {
  const adminId = req.user._id;

  try {
    let orders = getCachedAdminOrders(adminId);

    if (!orders) {
      orders = await Order.find()
        .populate('items.productId')
        .populate('user', 'name email')
        .populate('rider', 'name')
        .sort({ createdAt: -1 });

      setCachedAdminOrders(adminId, orders);
      logger.info(`Orders cached in memory for admin: ${adminId}, count: ${orders.length}`);
    } else {
      logger.info(`Orders retrieved from memory cache for admin: ${adminId}`);
    }

    res.json(orders);
  } catch (error) {
    logger.error(`Get admin orders error for admin ${adminId}: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── updateOrderStatus ───────────────────────────────────────────────────────
exports.updateOrderStatus = async (req, res) => {
  const { orderId, action } = req.body;
  const adminId = req.user._id;

  try {
    if (!['accept', 'reject'].includes(action)) return res.status(400).json({ message: 'Invalid action' });

    const order = await Order.findById(orderId).populate('items.productId user');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Unauthorized: Only admins can modify orders' });

    order.status = action === 'accept' ? 'accepted' : 'rejected';
    let additionalInfo = '';

    if (action === 'reject') {
      additionalInfo = 'Please contact customer service for more information.';
      for (const item of order.items) {
        const product = await Product.findById(item.productId);
        if (product) { product.stock += item.quantity; await product.save(); }
      }
    }

    const updatedOrder = await order.save();

    orderEventManager.broadcastOrderUpdate({
      type: 'status_update',
      order: updatedOrder,
      message: `Order #${orderId.slice(-6)} ${action}ed by admin`,
    });

    invalidateAdminOrdersCache();
    await sendOrderNotification(updatedOrder, order.status, additionalInfo);

    logger.info(`Order ${orderId} ${action}ed by admin ${adminId}`);
    res.json({ message: `Order ${action}ed`, order: updatedOrder });
  } catch (error) {
    logger.error(`Update order status error for order ${orderId}: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── updateDeliveryStatus ────────────────────────────────────────────────────
exports.updateDeliveryStatus = async (req, res) => {
  const { orderId, deliveryStatus } = req.body;
  const riderId = req.user._id;

  try {
    if (!['en_route', 'delivered'].includes(deliveryStatus)) {
      return res.status(400).json({ message: 'Invalid delivery status' });
    }

    const order = await Order.findById(orderId).populate('items.productId user rider');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.deliveryStatus === 'delivered') return res.status(400).json({ message: 'Order already delivered' });

    order.deliveryStatus = deliveryStatus;
    const updatedOrder = await order.save();

    orderEventManager.broadcastOrderUpdate({
      type: 'delivery_update',
      order: updatedOrder,
      message: `Order #${orderId.slice(-6)} delivery status: ${deliveryStatus}`,
    });

    await sendOrderNotification(updatedOrder, deliveryStatus);

    logger.info(`Delivery status updated to ${deliveryStatus} for order ${orderId} by rider ${riderId}`);
    res.json({ message: 'Delivery status updated', order: updatedOrder });
  } catch (error) {
    logger.error(`Update delivery status error for order ${orderId}: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── getRiderOrders ──────────────────────────────────────────────────────────
exports.getRiderOrders = async (req, res) => {
  const riderId = req.user._id;

  try {
    const orders = await Order.find({ rider: riderId, status: 'accepted' })
      .populate('items.productId')
      .populate('user', 'name email');
    res.json(orders);
  } catch (error) {
    logger.error(`Get rider orders error for rider ${riderId}: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── assignOrder ─────────────────────────────────────────────────────────────
exports.assignOrder = async (req, res) => {
  const { orderId, riderId } = req.body;

  try {
    const order = await Order.findById(orderId).populate('items.productId user');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Unauthorized: Only admins can assign orders' });

    if (riderId) {
      const rider = await User.findById(riderId);
      if (!rider || rider.role !== 'rider') return res.status(400).json({ message: 'Invalid rider' });
      order.rider = riderId;
      order.riderName = rider.name;
    }

    const updatedOrder = await order.save();

    orderEventManager.broadcastOrderUpdate({
      type: 'order_assigned',
      order: updatedOrder,
      message: `Order #${orderId.slice(-6)} assigned to ${updatedOrder.riderName}`,
    });

    logger.info(`Order ${orderId} assigned to rider ${riderId} by admin ${req.user._id}`);
    res.json({ message: 'Order assigned', order: updatedOrder });
  } catch (error) {
    logger.error(`Assign order error for order ${orderId}: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── getRiders ───────────────────────────────────────────────────────────────
exports.getRiders = async (req, res) => {
  try {
    const riders = await User.find({ role: 'rider' }).select('_id name');
    res.json(riders);
  } catch (error) {
    logger.error(`Get riders error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── pollOrders ──────────────────────────────────────────────────────────────
exports.pollOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('items.productId')
      .populate('user', 'name email')
      .populate('rider', 'name');
    res.json(orders);
  } catch (error) {
    logger.error(`Poll orders error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── clearOrderCache ─────────────────────────────────────────────────────────
exports.clearOrderCache = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Unauthorized' });
    invalidateAdminOrdersCache();
    logger.info(`Order cache cleared by admin: ${req.user._id}`);
    res.json({ message: 'Order cache cleared successfully' });
  } catch (error) {
    logger.error(`Clear cache error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── dropOrderCollection ─────────────────────────────────────────────────────
exports.dropOrderCollection = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Unauthorized' });
    await Order.collection.drop();
    invalidateAdminOrdersCache();
    logger.info(`Order collection dropped by admin: ${req.user._id}`);
    res.json({ message: 'Order collection dropped and caches cleared' });
  } catch (error) {
    logger.error(`Drop collection error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── trackOrder ──────────────────────────────────────────────────────────────
exports.trackOrder = async (req, res) => {
  const { orderId, transactionNumber } = req.query;

  try {
    if (!orderId && !transactionNumber) {
      return res.status(400).json({ message: 'Order ID or transaction number is required' });
    }

    const query = orderId ? { _id: orderId } : { transactionNumber };
    const order = await Order.findOne(query)
      .populate('items.productId', 'name price')
      .populate('rider', 'name');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    const statusHistory = [
      { status: 'pending', timestamp: order.createdAt, description: 'Order created and awaiting verification' },
      ...(order.status === 'processing' ? [{ status: 'processing', timestamp: order.updatedAt, description: 'Payment verified, order being processed' }] : []),
      ...(order.status === 'accepted' ? [{ status: 'accepted', timestamp: order.updatedAt, description: 'Order accepted by admin' }] : []),
      ...(order.status === 'rejected' ? [{ status: 'rejected', timestamp: order.updatedAt, description: 'Order rejected by admin' }] : []),
      ...(order.deliveryStatus === 'en_route' ? [{ status: 'en_route', timestamp: order.updatedAt, description: `Order en route${order.rider ? ` by ${order.rider.name}` : ''}` }] : []),
      ...(order.deliveryStatus === 'delivered' ? [{ status: 'delivered', timestamp: order.updatedAt, description: 'Order delivered to customer' }] : []),
    ];

    res.status(200).json({
      orderId: order._id.toString().slice(-6),
      transactionNumber: order.transactionNumber,
      status: order.status,
      deliveryStatus: order.deliveryStatus || 'not_assigned',
      riderName: order.rider ? order.rider.name : null,
      items: order.items.map((item) => ({ productName: item.productId.name, quantity: item.quantity, price: item.price })),
      totalAmount: order.totalAmount,
      deliveryFee: order.deliveryFee,
      createdAt: order.createdAt,
      statusHistory,
    });
  } catch (error) {
    logger.error(`Track order error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── shareOrderTracking ──────────────────────────────────────────────────────
exports.shareOrderTracking = async (req, res) => {
  const { orderId } = req.body;
  const adminId = req.user._id;

  try {
    if (!orderId) return res.status(400).json({ message: 'Order ID is required' });
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Unauthorized' });

    const order = await Order.findById(orderId).populate('user', 'email name');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const trackingUrl = `${process.env.FRONTEND_URL}/pages/track?orderId=${order._id}`;

    await emailService.sendTextEmail(
      order.customerInfo.email,
      `Track Your Order #${order._id.toString().slice(-6)}`,
      `Dear ${order.customerInfo.name},\n\nYour order #${order._id.toString().slice(-6)} can now be tracked online:\n\n${trackingUrl}\n\nThank you for shopping with Ollan Pharmacy!`
    );

    orderEventManager.broadcastOrderUpdate({
      type: 'tracking_shared',
      order,
      message: `Tracking link for order #${order._id.toString().slice(-6)} shared with ${order.customerInfo.name}`,
    });

    invalidateAdminOrdersCache();

    logger.info(`Tracking link shared for order ${orderId} by admin ${adminId}`);
    res.status(200).json({ message: 'Tracking link sent to customer', trackingUrl });
  } catch (error) {
    logger.error(`Share tracking link error for order ${orderId}: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Export seeder so app.js can call it on startup
exports.seedReferralCodes = seedReferralCodes;