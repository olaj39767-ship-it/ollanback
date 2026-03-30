const mongoose = require('mongoose');


const prescriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  location: { type: String, required: true },

  prescriptionUrl: { type: String, required: true },
  publicId: { type: String, required: true },
  originalName: String,
  mimeType: String,

  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Prescription", prescriptionSchema);