// src/controllers/cartController.js
const Cart = require("../models/Cart");
const logger = require("../config/logger");

console.log("Cart model:", Cart); // Debug: Should log Model { Cart }

exports.getCart = async (req, res) => {
  try {
    if (!Cart || typeof Cart.findOne !== "function") {
      logger.error("Cart model is not properly defined");
      return res.status(500).json({ message: "Cart model error" });
    }
    const cart = await Cart.findOne({ userId: req.user.id }).populate("items.productId");
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }
    logger.info(`Cart retrieved for user ${req.user.id}`);
    res.json(cart);
  } catch (error) {
    logger.error("Get cart error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.addToCart = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId || !quantity || quantity < 1) {
      return res.status(400).json({ message: "Product ID and quantity (minimum 1) are required" });
    }
    let cart = await Cart.findOne({ userId: req.user.id });
    if (!cart) {
      cart = new Cart({
        userId: req.user.id,
        items: [{ productId, quantity }],
      });
    } else {
      const itemIndex = cart.items.findIndex(item => item.productId.toString() === productId);
      if (itemIndex > -1) {
        cart.items[itemIndex].quantity += parseInt(quantity);
      } else {
        cart.items.push({ productId, quantity });
      }
    }
    await cart.save();
    logger.info(`Added product ${productId} to cart for user ${req.user.id}`);
    res.status(200).json({ message: "Product added to cart", cart });
  } catch (error) {
    logger.error("Add to cart error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.removeFromCart = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ message: "Product ID is required" });
    }
    const cart = await Cart.findOne({ userId: req.user.id });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }
    cart.items = cart.items.filter(item => item.productId.toString() !== productId);
    await cart.save();
    logger.info(`Removed product ${productId} from cart for user ${req.user.id}`);
    res.status(200).json({ message: "Product removed from cart", cart });
  } catch (error) {
    logger.error("Remove from cart error:", error);
    res.status(500).json({ message: "Server error" });
  }
};