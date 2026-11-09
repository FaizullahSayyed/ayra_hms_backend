export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumns("patients", {
    first_name: { type: "varchar(80)" },
    last_name: { type: "varchar(80)" },
  });

  pgm.sql(`
    WITH normalized_names AS (
      SELECT
        id,
        regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g') AS normalized_name
      FROM patients
    )
    UPDATE patients AS patient
    SET
      first_name = left(split_part(normalized.normalized_name, ' ', 1), 80),
      last_name = nullif(
        left(regexp_replace(normalized.normalized_name, '^[^ ]+[ ]*', ''), 80),
        ''
      )
    FROM normalized_names AS normalized
    WHERE patient.id = normalized.id
  `);

  pgm.addConstraint("patients", "patients_first_name_check", {
    check: "first_name IS NULL OR (char_length(btrim(first_name)) BETWEEN 1 AND 80)",
  });
  pgm.addConstraint("patients", "patients_last_name_check", {
    check: "last_name IS NULL OR (char_length(btrim(last_name)) BETWEEN 1 AND 80)",
  });
};

export const down = (pgm) => {
  pgm.dropConstraint("patients", "patients_last_name_check");
  pgm.dropConstraint("patients", "patients_first_name_check");
  pgm.dropColumns("patients", ["first_name", "last_name"]);
};
