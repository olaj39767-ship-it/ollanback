// controllers/paymentController.js
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/verify-payment
//
// Called by the frontend after Flutterwave's client callback fires.
// We re-verify the transaction directly with Flutterwave's API using the
// SECRET key (never exposed to the browser).
//
// Expected body: { transaction_id: number|string, expected_amount: number }
// ─────────────────────────────────────────────────────────────────────────────

const logger = require('../config/logger');

// Flutterwave secret key — set this in your .env as FLW_SECRET_KEY
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_VERIFY_URL = 'https://api.flutterwave.com/v3/transactions';

/**
 * Verify a Flutterwave transaction server-side.
 * Route: POST /api/orders/verify-payment
 * Auth:  open (no auth required — user may not be logged in at checkout)
 */
exports.verifyFlutterwavePayment = async (req, res) => {
  const { transaction_id, expected_amount } = req.body;

  // ── Basic input validation ──────────────────────────────────────────────
  if (!transaction_id) {
    return res.status(400).json({ verified: false, message: 'transaction_id is required' });
  }

  if (!expected_amount || isNaN(Number(expected_amount)) || Number(expected_amount) <= 0) {
    return res.status(400).json({ verified: false, message: 'A valid expected_amount is required' });
  }

  if (!FLW_SECRET_KEY) {
    logger.error('FLW_SECRET_KEY is not set in environment variables');
    return res.status(500).json({ verified: false, message: 'Payment verification not configured' });
  }

  try {
    // ── Call Flutterwave verify endpoint ───────────────────────────────────
    const flwRes = await fetch(`${FLW_VERIFY_URL}/${transaction_id}/verify`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${FLW_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!flwRes.ok) {
      const errText = await flwRes.text();
      logger.error(`Flutterwave verify HTTP ${flwRes.status}: ${errText}`);
      return res.status(502).json({
        verified: false,
        message: 'Could not reach Flutterwave verification service',
      });
    }

    const flwData = await flwRes.json();

    // ── Guard: Flutterwave API-level failure ───────────────────────────────
    if (flwData.status !== 'success') {
      logger.warn(`Flutterwave verify returned non-success status for tx ${transaction_id}: ${flwData.message}`);
      return res.status(400).json({ verified: false, message: flwData.message || 'Verification failed' });
    }

    const tx = flwData.data;

    // ── Security checks ────────────────────────────────────────────────────
    // 1. Transaction must be in a successful state
    if (tx.status !== 'successful') {
      logger.warn(`Transaction ${transaction_id} status is "${tx.status}", not "successful"`);
      return res.status(400).json({ verified: false, message: `Transaction status is "${tx.status}"` });
    }

    // 2. Currency must be NGN
    if (tx.currency !== 'NGN') {
      logger.warn(`Transaction ${transaction_id} currency mismatch: ${tx.currency}`);
      return res.status(400).json({ verified: false, message: 'Currency mismatch' });
    }

    // 3. Amount paid must be >= expected amount (allow tiny float rounding)
    const amountPaid = Number(tx.amount);
    const amountExpected = Number(expected_amount);

    if (amountPaid < amountExpected - 1) {
      logger.warn(
        `Transaction ${transaction_id} amount mismatch: paid ₦${amountPaid}, expected ₦${amountExpected}`
      );
      return res.status(400).json({
        verified: false,
        message: `Amount paid (₦${amountPaid}) is less than expected (₦${amountExpected})`,
      });
    }

    // ── All checks passed ──────────────────────────────────────────────────
    logger.info(
      `✅ Flutterwave payment verified: tx ${transaction_id} | ₦${amountPaid} | ${tx.payment_type || 'N/A'}`
    );

    return res.status(200).json({
      verified: true,
      transaction_id: tx.id,
      tx_ref: tx.tx_ref,
      amount: amountPaid,
      payment_type: tx.payment_type,
      message: 'Payment verified successfully',
    });

  } catch (error) {
    logger.error(`verifyFlutterwavePayment error for tx ${transaction_id}: ${error.message}`, {
      stack: error.stack,
    });
    return res.status(500).json({
      verified: false,
      message: 'Server error during payment verification',
    });
  }
};