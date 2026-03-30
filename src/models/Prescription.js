// models/Prescription.js
const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  prescriptionUrl: {
    type: String,
    required: true,
  },
  publicId: {                    // Important for deletion later
    type: String,
    required: true,
  },
  originalName: String,
  mimeType: String,
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Prescription", prescriptionSchema);