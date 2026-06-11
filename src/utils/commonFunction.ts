import ApiError from "./error";
import { UnauthorizedError } from "routing-controllers";

function handleErrorResponse(error: any, res: any) {
  console.error("Error handler caught error:", error);

  if (res.headersSent) {
    return;
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

    return res.status(409).json({
      status: "error",
      message: `${field} '${value}' already exists`
    });
  }

  if (error instanceof UnauthorizedError) {
    return res.status(error.httpCode || 401).json({
      status: "error",
      message: error.message || "Unauthorized"
    });
  }

  if (error instanceof ApiError) {
    return res
      .status(error.statusCode)
      .json(error.toResponse());
  }

  return res.status(500).json({
    status: "error",
    message: error.message || "Internal Server Error"
  });
}

export default handleErrorResponse;
