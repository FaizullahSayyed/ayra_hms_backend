export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("user_sessions", {
    session_hash: {
      type: "char(64)",
      primaryKey: true,
    },
    csrf_token_hash: {
      type: "char(64)",
      notNull: true,
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    expires_at: {
      type: "timestamptz",
      notNull: true,
    },
    revoked_at: {
      type: "timestamptz",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.createIndex("user_sessions", "user_id", {
    name: "idx_user_sessions_user_id",
  });
  pgm.createIndex("user_sessions", "expires_at", {
    name: "idx_user_sessions_expires_at",
  });
};

export const down = (pgm) => {
  pgm.dropTable("user_sessions");
};
