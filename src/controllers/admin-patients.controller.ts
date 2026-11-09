import type { QueryResultRow } from "pg";
import type { RequestHandler } from "express";
import { pool } from "../config/database.js";

interface PatientAccount extends QueryResultRow {
  id: string;
  name: string;
  phone: string | null;
  gender: string | null;
  created_at: Date | string;
}

interface PatientDatabase {
  query<T extends QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
}

const patientDatabase: PatientDatabase = {
  query: <T extends QueryResultRow>(sql: string) => pool.query<T>(sql),
};

export function createAdminPatientsHandler(
  database: PatientDatabase = patientDatabase,
): RequestHandler {
  return async (_request, response): Promise<void> => {
    try {
      const result = await database.query<PatientAccount>(
        `SELECT id, name, phone, gender, created_at
         FROM patients
         ORDER BY created_at DESC
         LIMIT 50`,
      );

      response.status(200).json({
        success: true,
        patients: result.rows.map((patient) => ({
          id: patient.id,
          name: patient.name,
          phone: patient.phone,
          gender: patient.gender,
          createdAt: patient.created_at instanceof Date
            ? patient.created_at.toISOString()
            : patient.created_at,
        })),
      });
    } catch (error) {
      console.error("Admin patient list failed.", error);
      response.status(503).json({
        success: false,
        message: "Unable to load patient accounts right now.",
      });
    }
  };
}

export const getAdminPatients = createAdminPatientsHandler();
