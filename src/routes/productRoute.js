const express = require("express");
const router = express.Router();
const { createProduct, getProducts, updateProduct, deleteProduct } = require("../controllers/productController");
const { authMiddleware, adminMiddleware } = require("../middleware/auth");
const { upload } = require('../config/cloudinary');

router.post("/create", authMiddleware, adminMiddleware, upload.single("image"), createProduct);
router.get("/", getProducts);
router.put("/:id", authMiddleware, adminMiddleware, upload.single("image"), updateProduct);
router.delete("/:id", authMiddleware, adminMiddleware, deleteProduct);

module.exports = router;