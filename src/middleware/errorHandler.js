const logger = require('winston');

const errorHandler = (err, req, res, next) => {
  logger.error(err.message, err);
  res.status(err.status || 500).json({
    message: err.message || 'Something went wrong',
  });
};

module.exports = errorHandler;