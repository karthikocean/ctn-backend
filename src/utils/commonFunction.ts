import ApiError from "./error";
import { logger } from "./logger";

function handleErrorResponse(error: any, res: any) {
  logger.error("Error handler caught error", error, "ErrorHandler");

  if (res.headersSent) {
    return;
  }

  // Handle JWT verification errors
  if (
    error?.name === "JsonWebTokenError" ||
    error?.name === "TokenExpiredError" ||
    error?.name === "NotBeforeError"
  ) {
    return res.status(401).json({
      status: "error",
      message: error.message || "Invalid or expired token"
    });
  }

  // Handle Razorpay SDK errors
  if (error && error.error && typeof error.error.description === "string") {
    return res.status(error.statusCode || 400).json({
      status: "error",
      message: `Razorpay Error: ${error.error.description}`
    });
  }

  if (error?.code === 11000) {

    let field = "field";
    let value = "";
    if (error.keyValue) {
      field = Object.keys(error.keyValue)[0];
      value = error.keyValue[field];
    }
    else if (typeof error.message === "string") {
      const match = error.message.match(/\{ (.+?): \"(.+?)\" \}/);
      if (match) {
        field = match[1];
        value = match[2];
      }
    }

    // // User-friendly message for name+type compound index (e.g. categories)
    // if (field === "name" || (error.keyValue && "name" in error.keyValue)) {
    //   const name = error.keyValue?.name || value;
    //   return res.status(409).json({
    //     status: "error",
    //     message: `${name} Name Already Exists`
    //   });
    // }

    return res.status(409).json({
      status: "error",
      message: `${field} '${value}' already exists`
    });
  }

  if (error instanceof ApiError) {
    return res
      .status(error.statusCode)
      .json(error.toResponse());
  }

  if (error && (typeof error.httpCode === "number" || typeof error.statusCode === "number" || typeof error.status === "number")) {
    const statusCode = error.httpCode || error.statusCode || error.status;
    if (statusCode === 413 || error.type === "entity.too.large") {
      return res.status(413).json({
        status: "error",
        message: "Payload Too Large: Request body exceeds maximum allowed limit."
      });
    }
    return res.status(statusCode).json({
      status: "error",
      message: error.message || "An error occurred"
    });
  }

  return res.status(500).json({
    status: "error",
    message: error.message || "Internal Server Error"
  });
}

export default handleErrorResponse;
