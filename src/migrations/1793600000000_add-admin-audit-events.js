export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("admin_audit_events", {
    id: {
      type: "bigserial",
      primaryKey: true,
    },
    actor_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    target_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    event_type: {
      type: "varchar(40)",
      notNull: true,
    },
    changed_fields: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'[]'::jsonb"),
    },
    password_changed: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint("admin_audit_events", "admin_audit_events_type_check", {
    check: "event_type IN ('staff_created', 'staff_updated')",
  });
  pgm.addConstraint("admin_audit_events", "admin_audit_events_fields_array_check", {
    check: "jsonb_typeof(changed_fields) = 'array'",
  });
  pgm.createIndex("admin_audit_events", ["target_user_id", "created_at"], {
    name: "idx_admin_audit_events_target_created",
  });
};

export const down = (pgm) => {
  pgm.dropTable("admin_audit_events");
};
