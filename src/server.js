const path = require("path");
const dotenv = require("dotenv");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");

const app = express();

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
}

let isConnected = false;
const connectDB = async () => {
  if (!isConnected) {
    await mongoose.connect(process.env.MONGO_URI);
    isConnected = true;
    console.log("✅ MongoDB connected");

    // Start cleanup job AFTER DB is connected
    require("./utils/cleanupPendingOrders");
  }
};

const corsOptions = {
  origin: ["https://www.ollanpharmacy.ng", "http://localhost:3000"],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

const sanitize = (obj) => {
  if (obj && typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      if (key.startsWith("$") || key.includes(".")) {
        delete obj[key];
      } else {
        sanitize(obj[key]);
      }
    }
  }
  return obj;
};

const mongoSanitizeMiddleware = (req, res, next) => {
  if (req.body) sanitize(req.body);
  if (req.params) sanitize(req.params);
  next();
};

app.use(helmet());
app.use(cors(corsOptions));

// ── Webhook MUST come before express.json() ───────────────────
// Flutterwave needs the raw body for signature verification
app.use(
  "/api/orders/webhook/flutterwave",
  express.raw({ type: "application/json" }),
  require("./routes/orderRoute").webhookRouter
);

// ── JSON parsing for all other routes ────────────────────────
app.use(express.json({ limit: "10kb" }));
app.use(mongoSanitizeMiddleware);

// ── Static files ──────────────────────────────────────────────
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── Routes ────────────────────────────────────────────────────
app.use("/api/auth", require("./routes/authRoute"));
app.use("/api/user", require("./routes/userRoute"));
app.use("/api/products", require("./routes/productRoute"));
app.use("/api/cart", require("./routes/cartRoute"));
app.use("/api/orders", require("./routes/orderRoute"));

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

// ── Vercel serverless vs local dev ────────────────────────────
if (process.env.IS_VERCEL) {
  module.exports = async (req, res) => {
    await connectDB();
    return app(req, res);
  };
} else {
  const PORT = process.env.PORT || 8080;
  connectDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error("❌ MongoDB connection failed:", err.message);
      process.exit(1);
    });
}