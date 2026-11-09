export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("patients", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: {
      type: "varchar(150)",
      notNull: true,
    },
    phone: {
      type: "varchar(32)",
    },
    gender: {
      type: "varchar(32)",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint("patients", "patients_gender_check", {
    check: "gender IS NULL OR gender IN ('female', 'male', 'non-binary', 'prefer-not-to-say')",
  });

  pgm.sql(`
    INSERT INTO patients (id, name, phone, gender, created_at, updated_at)
    SELECT id, name, phone, gender, created_at, updated_at
    FROM users
    WHERE role = 'patient'
  `);
  pgm.sql("DELETE FROM users WHERE role = 'patient'");
  pgm.sql('ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT');

  pgm.dropConstraint("users", "users_role_check");
  pgm.addConstraint("users", "users_role_check", {
    check: "role IN ('admin', 'doctor', 'nurse', 'biller', 'receptionist')",
  });
};

export const down = async (pgm) => {
  const { rows } = await pgm.db.query("SELECT EXISTS (SELECT 1 FROM patients) AS has_patients");
  if (rows[0]?.has_patients) {
    throw new Error("Cannot roll back patient data without losing records or recreating patient auth accounts.");
  }

  pgm.dropConstraint("users", "users_role_check");
  pgm.addConstraint("users", "users_role_check", {
    check: "role IN ('patient', 'biller', 'receptionist', 'nurse', 'doctor', 'admin')",
  });
  pgm.sql('ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT \'staff\'');
  pgm.dropTable("patients");
};
