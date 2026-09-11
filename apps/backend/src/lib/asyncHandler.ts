import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 does not forward a rejected promise from an async
// `(req, res) => {...}` handler to the error middleware automatically — an
// unexpected throw (a Prisma error, a DB hiccup, etc.) becomes an unhandled
// promise rejection, which crashes the whole process. Wrapping every async
// route handler with this forwards the error to `next(err)` instead, so it
// reaches app.ts's errorHandler and comes back as a clean 4xx/5xx response.
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
