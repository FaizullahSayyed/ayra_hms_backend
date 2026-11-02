export const shorthands = undefined;

export const up = (pgm) => {
  pgm.dropConstraint("users", "users_role_check");

  pgm.addConstraint("users", "users_role_check", {
    check:
      "role IN ('patient', 'biller', 'receptionist', 'nurse', 'doctor', 'admin')",
  });
};

export const down = (pgm) => {
  pgm.dropConstraint("users", "users_role_check");

  pgm.addConstraint("users", "users_role_check", {
    check: "role IN ('admin', 'doctor', 'staff')",
  });
};