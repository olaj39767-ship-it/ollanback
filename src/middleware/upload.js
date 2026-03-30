// middleware/upload.js
const multer = require("multer");
const logger = require("../config/logger");

// Use memoryStorage (stores file in RAM as buffer) - Perfect for Vercel + Cloudinary
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const validMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/jpg",
    "application/pdf",                    // Added PDF support (recommended)
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ];

  const validExtensions = ['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx'];

  const mimeType = file.mimetype.toLowerCase();
  const extension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

  if (validMimeTypes.includes(mimeType) || validExtensions.includes(extension)) {
    logger.debug(`Accepted file: ${file.originalname} (${file.mimetype})`);
    cb(null, true);
  } else {
    logger.error(`Rejected invalid file type: ${file.mimetype} | ${file.originalname}`);
    cb(new Error("Only JPEG, PNG, PDF, and DOCX files are allowed"), false);
  }
};

const upload = multer({
  storage: storage,                    // ← Changed from diskStorage to memoryStorage
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,         // 5MB limit (you can increase to 10MB if needed)
  },
});

logger.info("Multer configured with memoryStorage for Cloudinary uploads");

module.exports = upload;