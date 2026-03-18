const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  loggedInDiscountPercent:  { type: Number, default: 5, min: 0, max: 30 },
  minOrderForDiscount:      { type: Number, default: 0 },

  referralRewardAmount:     { type: Number, default: 0 },
  referralMinOrderValue:    { type: Number, default: 0 },

  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

schema.statics.getSettings = async function () {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({});
  }
  return doc;
};

module.exports = mongoose.model('AppSettings', schema);