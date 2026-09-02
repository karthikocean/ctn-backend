import {
  ExpressErrorMiddlewareInterface,
  Middleware,
  BadRequestError
} from "routing-controllers";
import { logger } from "../utils/logger";

@Middleware({ type: "after" })
export class ErrorLogger implements ExpressErrorMiddlewareInterface {
  error(error: unknown, req: any, res: any) {

    if (error instanceof BadRequestError) {
      const err: any = error;

      if (Array.isArray(err.errors)) {
        const formattedErrors = err.errors.map((e: any) => ({
          field: e.property,
          value: e.value,
          message: e.constraints
            ? Object.values(e.constraints)[0]
            : "Invalid value"
        }));

        return res.status(400).json({
          status: 400,
          message: "Validation failed",
          errors: formattedErrors
        });
      }
    }

    logger.error("Unhandled error in routing-controller", error, "ErrorLogger");

    const httpCode = (error as any)?.httpCode || 500;

    return res.status(httpCode).json({
      status: httpCode,
      message: (error as any)?.message || "Internal Server Error"
    });
  }
}
