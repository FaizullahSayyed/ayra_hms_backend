export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumns("users", {
    username: { type: "varchar(254)" },
    first_name: { type: "varchar(80)" },
    last_name: { type: "varchar(80)" },
    phone: { type: "varchar(32)" },
    gender: { type: "varchar(32)" },
  });

  pgm.addConstraint("users", "users_gender_check", {
    check: "gender IS NULL OR gender IN ('female', 'male', 'non-binary', 'prefer-not-to-say')",
  });

  pgm.createIndex("users", "username", {
    name: "users_username_key",
    unique: true,
  });
};

export const down = (pgm) => {
  pgm.dropIndex("users", "username", { name: "users_username_key" });
  pgm.dropConstraint("users", "users_gender_check");
  pgm.dropColumns("users", ["username", "first_name", "last_name", "phone", "gender"]);
};
