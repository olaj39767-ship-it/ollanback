const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const ProductController = require('../controllers/productController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const upload = require('../middleware/upload');
const roleMiddleware = require('../middleware/roleMiddleware');
const { verifyFlutterwavePayment } = require('../controllers/paymentController');

// ── Webhook router (exported separately so server.js can give it raw body) ──
const webhookRouter = express.Router();
webhookRouter.post('/', orderController.handleFlutterwaveWebhook);

// ── All other order routes ─────────────────────────────────────────────────
router.post('/create-pending', optionalAuth, orderController.createPendingOrder);
router.post('/create', optionalAuth, orderController.createOrder);

router.post('/verify-payment', authMiddleware, adminMiddleware, orderController.verifyPayment);
router.post('/verify-payment-real', verifyFlutterwavePayment);

router.get('/my-orders', authMiddleware, orderController.getUserOrders);
router.get('/all', authMiddleware, adminMiddleware, orderController.getAllOrders);
router.get('/admin-orders', authMiddleware, roleMiddleware(['admin']), orderController.getAdminOrders);
router.get('/referral-analytics', authMiddleware, roleMiddleware(['admin']), orderController.getReferralAnalytics);

router.post('/update-order-status', authMiddleware, roleMiddleware(['admin']), orderController.updateOrderStatus);
router.post('/assign-order', authMiddleware, roleMiddleware(['admin']), orderController.assignOrder);

router.get('/rider-orders', authMiddleware, roleMiddleware(['rider']), orderController.getRiderOrders);
router.post('/update-delivery-status', authMiddleware, roleMiddleware(['rider']), orderController.updateDeliveryStatus);
router.get('/riders', authMiddleware, roleMiddleware(['admin']), orderController.getRiders);

router.post('/send-prescription', orderController.sendPrescription);
router.get('/track', orderController.trackOrder);
router.post('/share-tracking', authMiddleware, roleMiddleware(['admin']), orderController.shareOrderTracking);

router.post('/upload-prescription', upload.single('prescription'), ProductController.uploadPrescription);
router.get('/prescriptions', ProductController.getAllPrescriptions);
router.post('/clear-cache', authMiddleware, roleMiddleware(['admin']), orderController.clearOrderCache);
router.delete('/cleanup-stale', authMiddleware, adminMiddleware, orderController.cleanupStalePendingOrders);
module.exports = router;
module.exports.webhookRouter = webhookRouter;