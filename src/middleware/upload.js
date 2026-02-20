const multer = require("multer");
const path = require("path");
const fs = require("fs");
const logger = require("../config/logger");

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  logger.info(`Created uploads directory: ${uploadDir}`);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    logger.debug(`Multer destination: ${uploadDir}`);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    const filename = `${uniqueSuffix}${ext}`;
    logger.debug(`Saving file as: ${filename}`);
    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  const validTypes = ["image/jpeg", "image/png", "image/jpg"];
  logger.debug(`Received file MIME type: ${file.mimetype}`);
  
  const mimeType = file.mimetype.toLowerCase();
  const fileExtension = path.extname(file.originalname).toLowerCase();
  const validExtensions = ['.jpg', '.jpeg', '.png'];
  
  if (validTypes.includes(mimeType) || validExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    logger.error(`Invalid file type: ${file.mimetype}, extension: ${fileExtension}`);
    cb(new Error("Only JPEG, JPG, or PNG files are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { 
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Export the upload object so you can use upload.single() in routes
module.exports = upload;