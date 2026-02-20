const orderEventManager = require('../events/orderEvents'); // Replace Redis import
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const User = require('../models/User');
const emailService = require('../config/emailService');
const formidable = require('formidable');
const fs = require('fs/promises');
const logger = require('../config/logger');

// In-memory cache for admin orders (replace Redis cache)
const adminOrdersCache = new Map();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

// Helper function to get cached data
const getCachedAdminOrders = (adminId) => {
  const cached = adminOrdersCache.get(adminId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  adminOrdersCache.delete(adminId);
  return null;
};

// Helper function to set cached data
const setCachedAdminOrders = (adminId, data) => {
  adminOrdersCache.set(adminId, {
    data,
    timestamp: Date.now()
  });
};

// Helper function to invalidate cache
const invalidateAdminOrdersCache = (adminId = null) => {
  if (adminId) {
    adminOrdersCache.delete(adminId);
  } else {
    adminOrdersCache.clear();
  }
};

exports.sendPrescription = async (req, res) => {
  try {
    // Parse the incoming form data
    const form = new formidable.IncomingForm({ multiples: true });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) {
          logger.error(`Form parsing error: ${err.message}`);
          reject(err);
        }
        resolve({ fields, files });
      });
    });

    // Extract and validate form fields
    const { name, email, phone, location } = fields;

    if (!name || !email || !phone || !location) {
      logger.error('Missing required fields in prescription submission', { fields });
      return res.status(400).json({ message: 'All required fields (name, email, phone, location) must be provided' });
    }

    // Validate file uploads
    const fileArray = Array.isArray(files.files) ? files.files : files.files ? [files.files] : [];
    if (fileArray.length === 0) {
      logger.error('No files uploaded in prescription submission');
      return res.status(400).json({ message: 'At least one file must be uploaded' });
    }

    // Validate file types
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const invalidFiles = fileArray.filter((file) => !allowedTypes.includes(file.mimetype));
    if (invalidFiles.length > 0) {
      logger.error('Invalid file types uploaded', { invalidFiles: invalidFiles.map(f => f.originalFilename) });
      return res.status(400).json({ message: 'Only JPEG, PNG, PDF, DOC, and DOCX files are allowed' });
    }

    // Prepare email attachments
    const attachments = await Promise.all(
      fileArray.map(async (file) => ({
        filename: file.originalFilename,
        content: await fs.readFile(file.filepath),
      }))
    );

    // Prepare email content
    const emailContent = `
      New Prescription Submission:
      Name: ${name}
      Email: ${email}
      Phone: ${phone}
      Location: ${location}
      Attached Files: ${fileArray.map(f => f.originalFilename).join(', ')}
    `;

    // Send email using emailService.sendTextEmail
    await emailService.sendTextEmail(
      process.env.EMAIL_USER, // Send to your email (services@ollanpharmacy.ng)
      `New Prescription Upload from ${name}`,
      emailContent,
      { attachments } // Pass attachments as part of mailOptions
    );

    // Clean up temporary files
    await Promise.all(fileArray.map((file) => fs.unlink(file.filepath)));

    // Broadcast prescription submission to admins
    orderEventManager.broadcastEvent('prescription_submitted', {
      name,
      email,
      phone,
      location,
      files: fileArray.map(f => f.originalFilename),
      timestamp: new Date().toISOString()
    });

    logger.info(`Prescription submitted successfully for ${name} (${email})`, {
      files: fileArray.map(f => f.originalFilename),
    });
    res.status(200).json({ message: 'Prescription uploaded and email sent successfully' });
  } catch (error) {
    logger.error(`Send prescription error: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

async function sendOrderNotification(order, status, additionalInfo = '') {
  try {
    const email = order.customerInfo.email;
    const customerName = order.customerInfo.name;
    const orderId = order._id.toString().slice(-6);
    await emailService.sendOrderStatusUpdate(email, customerName, orderId, status, additionalInfo);
  } catch (error) {
    logger.error(`Email notification failed for order ${order._id}: ${error.message}`);
  }
}

exports.createOrder = async (req, res) => {
  const user = req.user;
  const { customerInfo, deliveryFee, prescriptionUrl } = req.body;

  try {
    // Log request body for debugging
    logger.info(`Create order request for user ${user._id}: ${JSON.stringify(req.body)}`);

    if (
      !user ||
      !customerInfo ||
      !customerInfo.name ||
      !customerInfo.email ||
      !customerInfo.phone ||
      !customerInfo.transactionNumber ||
      deliveryFee === undefined
    ) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    // Validate transactionNumber format (example: at least 6 characters)
    if (!customerInfo.transactionNumber.trim() || customerInfo.transactionNumber.length < 6) {
      return res.status(400).json({ message: 'Invalid transaction number' });
    }

    const cart = await Cart.findOne({ userId: user._id }).populate('items.productId');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    let total = 0;
    const items = cart.items.map((item) => {
      total += item.productId.price * item.quantity;
      return {
        productId: item.productId._id,
        quantity: item.quantity,
        price: item.productId.price,
      };
    });

    for (const item of cart.items) {
      const product = await Product.findById(item.productId);
      if (!product || product.stock < item.quantity) {
        return res.status(400).json({ message: `Insufficient stock for ${product?.name || 'item'}` });
      }
      product.stock -= item.quantity;
      await product.save();
    }

    const expectedDeliveryFee = total > 0
      ? customerInfo.deliveryOption === 'express'
        ? 1500
        : customerInfo.deliveryOption === 'timeframe' && total < 5000
        ? 500
        : 0
      : 0;

    if (deliveryFee !== expectedDeliveryFee) {
      return res.status(400).json({ message: 'Invalid delivery fee' });
    }

    const totalAmount = total + deliveryFee;

    const order = new Order({
      user: user._id,
      items,
      customerInfo,
      deliveryFee,
      prescriptionUrl,
      totalAmount,
      transactionNumber: customerInfo.transactionNumber,
      paymentReference: `OLLAN_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
      status: 'pending',
    });

    const savedOrder = await order.save();
    await Cart.findOneAndDelete({ userId: user._id });

    // Broadcast new order to all connected admins
    orderEventManager.broadcastOrderUpdate({
      type: 'new_order',
      order: savedOrder,
      message: `New order #${savedOrder._id.toString().slice(-6)} created by ${customerInfo.name}`
    });

    // Invalidate admin orders cache
    invalidateAdminOrdersCache();

    await sendOrderNotification(savedOrder, 'pending');

    logger.info(`Order created for user: ${user._id}`);
    res.status(201).json({ message: 'Order created', order: savedOrder });
  } catch (error) {
    logger.error(`Create order error for user ${user._id}: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.uploadPrescription = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const prescriptionUrl = `/uploads/${req.file.filename}`;
    res.json({ prescriptionUrl });
  } catch (error) {
    logger.error(`Upload prescription error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.verifyPayment = async (req, res) => {
  const { orderId, paymentDetails } = req.body;
  const adminId = req.user._id;

  try {
    if (!orderId) {
      logger.error(`Missing required field: orderId=${orderId}`);
      return res.status(400).json({ message: 'Order ID is required' });
    }

    if (req.user.role !== 'admin') {
      logger.error(`Unauthorized payment verification attempt by user: ${adminId}`);
      return res.status(403).json({ message: 'Unauthorized: Only admins can verify payments' });
    }

    const order = await Order.findById(orderId).populate('items.productId user');
    if (!order) {
      logger.error(`Order not found for orderId: ${orderId}`);
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.status !== 'pending') {
      logger.error(`Order ${orderId} is not in pending status: ${order.status}`);
      return res.status(400).json({ message: 'Order is not in pending status' });
    }

    order.status = 'processing';
    order.paymentDetails = paymentDetails || 'Manually verified by seller';
    order.paymentReference = order.paymentReference || `MANUAL_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    const updatedOrder = await order.save();

    // Broadcast payment verification to all connected admins
    orderEventManager.broadcastOrderUpdate({
      type: 'payment_verified',
      order: updatedOrder,
      message: `Payment verified for order #${orderId.slice(-6)} by admin`
    });

    // Invalidate cache
    invalidateAdminOrdersCache();

    await sendOrderNotification(updatedOrder, 'processing', paymentDetails);

    logger.info(`Payment manually verified for order: ${orderId} by admin: ${adminId}`);
    res.json({ message: 'Payment manually verified', order: updatedOrder });
  } catch (error) {
    logger.error(`Manual payment verification error for order ${orderId}: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getUserOrders = async (req, res) => {
  const userEmail = req.user.email;

  try {
    if (!userEmail) {
      logger.error('User email not provided in request');
      return res.status(400).json({ message: 'User email is required' });
    }

    const orders = await Order.find({ 'customerInfo.email': userEmail }).populate('items.productId');
    logger.info(`Orders retrieved for user email: ${userEmail}, count: ${orders.length}`);
    res.json(orders);
  } catch (error) {
    logger.error(`Get user orders error for email ${userEmail}: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

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

exports.getAdminOrders = async (req, res) => {
  const adminId = req.user._id;

  try {
    // Check memory cache first
    let orders = getCachedAdminOrders(adminId);

    if (!orders) {
      orders = await Order.find()
        .populate('items.productId')
        .populate('user', 'name email')
        .populate('rider', 'name')
        .sort({ createdAt: -1 });
      
      // Cache the orders in memory
      setCachedAdminOrders(adminId, orders);
      logger.info(`Orders cached in memory for admin: ${adminId}, count: ${orders.length}`);
    } else {
      logger.info(`Orders retrieved from memory cache for admin: ${adminId}`);
    }

    logger.info(`Orders retrieved for admin: ${adminId}, count: ${orders.length}`);
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
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    const order = await Order.findById(orderId).populate('items.productId user');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized: Only admins can modify orders' });
    }

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

    // Broadcast order status update
    orderEventManager.broadcastOrderUpdate({
      type: 'status_update',
      order: updatedOrder,
      message: `Order #${orderId.slice(-6)} ${action}ed by admin`
    });

    // Invalidate cache
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
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

  

    if (order.deliveryStatus === 'delivered') {
      return res.status(400).json({ message: 'Order already delivered' });
    }

    order.deliveryStatus = deliveryStatus;
    const updatedOrder = await order.save();

    // Broadcast delivery status update
    orderEventManager.broadcastOrderUpdate({
      type: 'delivery_update',
      order: updatedOrder,
      message: `Order #${orderId.slice(-6)} delivery status: ${deliveryStatus}`
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
    logger.info(`Orders retrieved for rider: ${riderId}, count: ${orders.length}`);
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
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized: Only admins can assign orders' });
    }

    if (riderId) {
      const rider = await User.findById(riderId);
      if (!rider || rider.role !== 'rider') {
        return res.status(400).json({ message: 'Invalid rider' });
      }
      order.rider = riderId;
      order.riderName = rider.name;
    }

    const updatedOrder = await order.save();

    // Broadcast order assignment
    orderEventManager.broadcastOrderUpdate({
      type: 'order_assigned',
      order: updatedOrder,
      message: `Order #${orderId.slice(-6)} assigned to ${updatedOrder.riderName}`
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
    logger.info(`Riders retrieved, count: ${riders.length}`);
    res.json(riders);
  } catch (error) {
    logger.error(`Get riders error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.pollOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('items.productId')
      .populate('user', 'name email')
      .populate('rider', 'name');
    logger.info(`Orders polled, count: ${orders.length}`);
    res.json(orders);
  } catch (error) {
    logger.error(`Poll orders error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// New endpoint to clear memory cache for testing
exports.clearOrderCache = async (req, res) => {
  const adminId = req.user._id;

  try {
    if (req.user.role !== 'admin') {
      logger.error(`Unauthorized cache clear attempt by user: ${adminId}`);
      return res.status(403).json({ message: 'Unauthorized: Only admins can clear cache' });
    }

    invalidateAdminOrdersCache();
    logger.info(`Order cache cleared by admin: ${adminId}`);

    res.json({ message: 'Order cache cleared successfully' });
  } catch (error) {
    logger.error(`Clear cache error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Updated drop collection endpoint (removed Redis references)
exports.dropOrderCollection = async (req, res) => {
  const adminId = req.user._id;

  try {
    if (req.user.role !== 'admin') {
      logger.error(`Unauthorized collection drop attempt by user: ${adminId}`);
      return res.status(403).json({ message: 'Unauthorized: Only admins can drop collections' });
    }

    await Order.collection.drop();
    logger.info(`Order collection dropped by admin: ${adminId}`);

    // Clear memory cache
    invalidateAdminOrdersCache();
    logger.info('Cleared all order-related memory caches');

    res.json({ message: 'Order collection dropped and caches cleared' });
  } catch (error) {
    logger.error(`Drop collection error: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Add this endpoint to your existing controller file
exports.trackOrder = async (req, res) => {
  const { orderId, transactionNumber } = req.query;

  try {
    // Validate input
    if (!orderId && !transactionNumber) {
      logger.error('Missing required query parameter: orderId or transactionNumber');
      return res.status(400).json({ message: 'Order ID or transaction number is required' });
    }

    // Find order by orderId or transactionNumber
    const query = orderId
      ? { _id: orderId }
      : { transactionNumber: transactionNumber };

    const order = await Order.findOne(query)
      .populate('items.productId', 'name price') // Only populate necessary product fields
      .populate('rider', 'name'); // Only populate rider name

    if (!order) {
      logger.error(`Order not found for query: ${JSON.stringify(query)}`);
      return res.status(404).json({ message: 'Order not found' });
    }

    // Create status history (assuming status changes are tracked in an array)
    // You may need to modify your Order model to store status history
    const statusHistory = [
      {
        status: 'pending',
        timestamp: order.createdAt,
        description: 'Order created and awaiting verification'
      },
      ...(order.status === 'processing' ? [{
        status: 'processing',
        timestamp: order.updatedAt, // Use updatedAt or add specific timestamps in your model
        description: 'Payment verified, order being processed'
      }] : []),
      ...(order.status === 'accepted' ? [{
        status: 'accepted',
        timestamp: order.updatedAt,
        description: 'Order accepted by admin'
      }] : []),
      ...(order.status === 'rejected' ? [{
        status: 'rejected',
        timestamp: order.updatedAt,
        description: 'Order rejected by admin'
      }] : []),
      ...(order.deliveryStatus === 'en_route' ? [{
        status: 'en_route',
        timestamp: order.updatedAt,
        description: `Order en route to delivery${order.rider ? ` by ${order.rider.name}` : ''}`
      }] : []),
      ...(order.deliveryStatus === 'delivered' ? [{
        status: 'delivered',
        timestamp: order.updatedAt,
        description: 'Order delivered to customer'
      }] : [])
    ];

    // Prepare response with limited, non-sensitive information
    const response = {
      orderId: order._id.toString().slice(-6),
      transactionNumber: order.transactionNumber,
      status: order.status,
      deliveryStatus: order.deliveryStatus || 'not_assigned',
      riderName: order.rider ? order.rider.name : null,
      items: order.items.map(item => ({
        productName: item.productId.name,
        quantity: item.quantity,
        price: item.price
      })),
      totalAmount: order.totalAmount,
      deliveryFee: order.deliveryFee,
      createdAt: order.createdAt,
      statusHistory
    };

    logger.info(`Order tracked successfully: ${order._id}`);
    res.status(200).json(response);
  } catch (error) {
    logger.error(`Track order error: ${error.message}`, { query: { orderId, transactionNumber } });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.shareOrderTracking = async (req, res) => {
  const { orderId } = req.body;
  const adminId = req.user._id;

  try {
    // Validate input
    if (!orderId) {
      logger.error(`Missing required field: orderId=${orderId}`);
      return res.status(400).json({ message: 'Order ID is required' });
    }

    // Check admin role
    if (req.user.role !== 'admin') {
      logger.error(`Unauthorized tracking link share attempt by user: ${adminId}`);
      return res.status(403).json({ message: 'Unauthorized: Only admins can share tracking links' });
    }

    // Find the order
    const order = await Order.findById(orderId).populate('user', 'email name');
    if (!order) {
      logger.error(`Order not found for orderId: ${orderId}`);
      return res.status(404).json({ message: 'Order not found' });
    }

    // Generate tracking URL
    const trackingUrl = `${process.env.FRONTEND_URL}/pages/track?orderId=${order._id}`;
    
    // Prepare email content
    const emailContent = `
      Dear ${order.customerInfo.name},
      
      Your order #${order._id.toString().slice(-6)} can now be tracked online.
      Click the link below to view the status of your order:
      
      ${trackingUrl}
      
      Thank you for shopping with Ollan Pharmacy!
      
      Best regards,
      Ollan Pharmacy Team
    `;

    // Send email to user
    await emailService.sendTextEmail(
      order.customerInfo.email,
      `Track Your Order #${order._id.toString().slice(-6)}`,
      emailContent
    );

    // Broadcast event for tracking link shared (optional, for admin visibility)
    orderEventManager.broadcastOrderUpdate({
      type: 'tracking_shared',
      order: order,
      message: `Tracking link for order #${order._id.toString().slice(-6)} shared with ${order.customerInfo.name}`
    });

    // Invalidate admin orders cache (optional, if tracking status affects admin view)
    invalidateAdminOrdersCache();

    logger.info(`Tracking link shared for order ${orderId} by admin ${adminId}`);
    res.status(200).json({ message: 'Tracking link sent to customer', trackingUrl });
  } catch (error) {
    logger.error(`Share tracking link error for order ${orderId}: ${error.message}`);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};