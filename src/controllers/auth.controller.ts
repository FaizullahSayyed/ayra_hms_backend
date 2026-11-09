import type { RequestHandler } from "express";

export const patientRegistrationDeferred: RequestHandler = (_request, response) => {
  response.status(501).json({
    success: false,
    code: "PATIENT_REGISTRATION_DEFERRED",
    message: "Patient registration is not available yet.",
  });
};