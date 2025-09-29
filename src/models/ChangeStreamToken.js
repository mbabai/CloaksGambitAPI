const mongoose = require('mongoose');

const changeStreamTokenSchema = new mongoose.Schema({
  streamName: { type: String, unique: true, required: true },
  token: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

changeStreamTokenSchema.statics.getToken = async function(streamName) {
  const doc = await this.findOne({ streamName });
  return doc ? doc.token : null;
};

changeStreamTokenSchema.statics.saveToken = async function(streamName, token) {
  await this.updateOne({ streamName }, { token }, { upsert: true });
};

changeStreamTokenSchema.statics.clearToken = async function(streamName) {
  await this.deleteOne({ streamName });
};

module.exports = mongoose.model('ChangeStreamToken', changeStreamTokenSchema);
