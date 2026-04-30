// // middlewares/upload.middleware.ts
// import { Request, Response, NextFunction } from "express";
// import multer from "multer";

// const upload = multer({
//   limits: {
//     fileSize: 10 * 1024 * 1024, // 10 MB
//     files: 5,
//   },
//   fileFilter: (req, file, cb) => {
//     // Optional: restrict file types
//     const allowedTypes = /jpeg|jpg|png|pdf/;
//     const extname = allowedTypes.test(file.originalname.toLowerCase());
//     const mimetype = allowedTypes.test(file.mimetype);

//     if (mimetype && extname) {
//       return cb(null, true);
//     } else {
//       cb(new Error("Invalid file type. Only JPEG, PNG, PDF allowed."));
//     }
//   },
// });

// export const uploadMiddleware = upload.any(); // or .single('file'), .array('files', 5), etc.
