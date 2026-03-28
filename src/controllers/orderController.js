const orderEventManager = require('../events/orderEvents');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const emailService = require('../config/emailService');
const formidable = require('formidable');
const fs = require('fs/promises');
const logger = require('../config/logger');

// ─── In-memory cache for admin orders ───
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

// ─── Helper: Send order notification ───
async function sendOrderNotification(order, status, additionalInfo = '') {
  try {
    const { email, name } = order.customerInfo;
    const orderId = order._id.toString().slice(-6);
    await emailService.sendOrderStatusUpdate(email, name, orderId, status, additionalInfo);
  } catch (error) {
    logger.error(`Email notification failed for order ${order._id}: ${error.message}`);
  }
}

// ====================== CREATE ORDER ======================
// ====================== CREATE ORDER ======================
exports.createOrder = async (req, res) => {
  const user = req.user || null;

  const {
    customerInfo,
    items: cartItems,
    prescriptionUrl = '',
    referralCode,
    storeCreditApplied = false,  // boolean flag from frontend — never trust an amount
  } = req.body;

  console.log('req.user:', user);
  console.log('storeCreditApplied flag from body:', storeCreditApplied);

  try {
    if (
      !customerInfo?.name?.trim() ||
      !customerInfo?.email?.trim() ||
      !customerInfo?.phone?.trim() ||
      !customerInfo?.transactionNumber?.trim() ||
      !customerInfo?.deliveryOption
    ) {
      return res.status(400).json({ message: 'Missing required customer information' });
    }

    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    const txNumber = customerInfo.transactionNumber.trim();
    if (txNumber.length < 6) {
      return res.status(400).json({ message: 'Transaction number too short' });
    }

    let normalizedReferral = referralCode ? referralCode.trim().toUpperCase() : null;
    const normalizedEmail = customerInfo.email.trim().toLowerCase();

    // === Calculate subtotal first ===
    let subtotal = 0;
    const validatedItems = [];

    for (const item of cartItems) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(400).json({ message: `Product not found: ${item.productId}` });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.name} (only ${product.stock} left)`,
        });
      }

      product.stock -= item.quantity;
      await product.save();

      subtotal += product.price * item.quantity;
      validatedItems.push({
        productId: product._id,
        quantity: item.quantity,
        price: product.price,
        name: product.name,
      });
    }

    let deliveryFee = 0;
    const option = customerInfo.deliveryOption.toLowerCase();
    if (option === 'express') deliveryFee = 0;
    else if (option === 'timeframe') deliveryFee = subtotal < 5000 ? 500 : 0;
    else if (option === 'pickup') deliveryFee = 0;
    else return res.status(400).json({ message: 'Invalid delivery option' });

    const totalAmount = subtotal + deliveryFee;

    // === Read store credit from DB — amount never comes from frontend ===
    let creditUsed = 0;

    if (storeCreditApplied && user) {
      const userDoc = await User.findById(user._id);
      if (!userDoc) return res.status(404).json({ message: 'User not found' });

      const availableCredit = userDoc.storeCredit || 0;
      if (availableCredit > 0) {
        // Cap at total order amount — user can't get change back
        creditUsed = Math.min(availableCredit, totalAmount);
        console.log(`Store credit to use: ₦${creditUsed} (available: ₦${availableCredit})`);
      }
    }

    const finalPayable = Math.max(0, totalAmount - creditUsed);

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
      totalAmount,
      storeCreditUsed: creditUsed,
      finalPayable,
      referralCodeUsed: normalizedReferral,
      prescriptionUrl,
      paymentReference: `OLLAN_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
      status: 'pending',
    });

    const savedOrder = await order.save();

    // === Deduct store credit using $inc to prevent race conditions ===
    if (user && creditUsed > 0) {
      await User.findByIdAndUpdate(
        user._id,
        { $inc: { storeCredit: -creditUsed } },
        { new: true }
      );
      logger.info(
        `Store credit deducted: ₦${creditUsed} from user ${user.email} for order ${savedOrder._id}`
      );
    }

    logger.info(
      `Order created: ${savedOrder._id} | Referral: ${normalizedReferral || 'None'} | Store Credit Used: ₦${creditUsed}`
    );

    orderEventManager.broadcastOrderUpdate({
      type: 'new_order',
      order: savedOrder,
      message: `New order #${savedOrder._id.toString().slice(-6)} created`,
    });

    invalidateAdminOrdersCache();
    await sendOrderNotification(savedOrder, 'pending');

    return res.status(201).json({
      message: 'Order created successfully',
      orderId: savedOrder._id,
      order: savedOrder,
      storeCreditApplied: creditUsed > 0,
      storeCreditAmount: creditUsed,
      finalPayable,
      suggestRegistration: !user && normalizedEmail,
    });
  } catch (error) {
    logger.error(`Create order error: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ====================== VERIFY PAYMENT + 3% REFERRAL BONUS ======================
exports.verifyPayment = async (req, res) => {
  const { orderId, paymentDetails } = req.body;
  const adminId = req.user?._id;

  try {
    if (!orderId) return res.status(400).json({ message: 'Order ID is required' });
    if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Only admins can verify payments' });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'pending') {
      return res.status(400).json({ message: `Order is already ${order.status}` });
    }

    order.status = 'processing';
    order.paymentDetails = paymentDetails || 'Manually verified by admin';
    order.paymentReference = order.paymentReference || `MANUAL_${Date.now()}`;

    const updatedOrder = await order.save();

    // Apply 3% store credit to referrer after payment verification
    if (updatedOrder.referralCodeUsed) {
      const referrer = await User.findOne({ referralCode: updatedOrder.referralCodeUsed });

      if (referrer) {
        const bonusAmount = Math.round(updatedOrder.subtotal * 0.03 * 100) / 100;

        referrer.addStoreCredit(bonusAmount);
        await referrer.save();

        logger.info(`✅ 3% Referral bonus: ${bonusAmount} credited to ${referrer.email} | Code: ${updatedOrder.referralCodeUsed} | Order: ${orderId}`);
      } else {
        logger.warn(`Referral code ${updatedOrder.referralCodeUsed} used but no matching user found`);
      }
    }

    orderEventManager.broadcastOrderUpdate({
      type: 'payment_verified',
      order: updatedOrder,
      message: `Payment verified for order #${orderId.slice(-6)}`,
    });

    invalidateAdminOrdersCache();
    await sendOrderNotification(updatedOrder, 'processing', paymentDetails);

    res.json({
      success: true,
      message: 'Payment verified successfully. Referral bonus applied if applicable.',
      order: updatedOrder
    });
  } catch (error) {
    logger.error(`Payment verification error: ${error.message}`, { orderId });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ====================== UPLOAD PRESCRIPTION ======================
exports.uploadPrescription = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const prescriptionUrl = `/uploads/${req.file.filename}`;

    logger.info(`Prescription uploaded: ${prescriptionUrl} by user ${req.user?._id || 'guest'}`);

    res.status(200).json({
      success: true,
      message: 'Prescription uploaded successfully',
      prescriptionUrl
    });
  } catch (error) {
    logger.error(`Upload prescription error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ====================== REFERRAL ANALYTICS ======================
exports.getReferralAnalytics = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can access referral analytics' });
    }

    const referrers = await User.find({
      referralCode: { $exists: true, $ne: null }
    }).select('name email referralCode storeCredit').lean();

    const analytics = [];

    for (const referrer of referrers) {
      const ordersUsingCode = await Order.countDocuments({
        referralCodeUsed: referrer.referralCode,
        status: { $in: ['processing', 'accepted', 'delivered'] }
      });

      const totalBonusResult = await Order.aggregate([
        { 
          $match: { 
            referralCodeUsed: referrer.referralCode,
            status: { $in: ['processing', 'accepted', 'delivered'] }
          }
        },
        { $group: { _id: null, totalSubtotal: { $sum: '$subtotal' } } }
      ]);

      const totalEarned = totalBonusResult.length > 0 
        ? Math.round(totalBonusResult[0].totalSubtotal * 0.03 * 100) / 100 
        : 0;

      analytics.push({
        userId: referrer._id,
        name: referrer.name,
        email: referrer.email,
        referralCode: referrer.referralCode,
        currentStoreCredit: referrer.storeCredit || 0,
        timesUsed: ordersUsingCode,
        totalEarnedFromReferrals: totalEarned
      });
    }

    analytics.sort((a, b) => b.timesUsed - a.timesUsed);

    const totalReferralsUsed = analytics.reduce((sum, item) => sum + item.timesUsed, 0);

    res.json({
      success: true,
      totalReferrers: analytics.length,
      totalReferralsUsed,
      data: analytics
    });
  } catch (error) {
    logger.error(`Referral analytics error: ${error.message}`);
    res.status(500).json({ message: 'Server error' });
  }
};

// ====================== YOUR ORIGINAL FUNCTIONS (PRESERVED) ======================

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
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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

exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('items.productId')
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    logger.info(`All orders retrieved, count: ${orders.length}`);
    res.json(orders);
  } catch (error) {
    logger.error(`Get all orders error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

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
        if (product) { 
          product.stock += item.quantity; 
          await product.save(); 
        }
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

exports.getRiders = async (req, res) => {
  try {
    const riders = await User.find({ role: 'rider' }).select('_id name');
    res.json(riders);
  } catch (error) {
    logger.error(`Get riders error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

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

// Clear cache
exports.clearOrderCache = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Unauthorized' });
    invalidateAdminOrdersCache();
    logger.info(`Order cache cleared by admin: ${req.user._id}`);
    res.json({ message: 'Order cache cleared successfully' });
  } catch (error) {
    logger.error(`Clear cache error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};