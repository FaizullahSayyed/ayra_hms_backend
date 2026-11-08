const SSL_CONNECTION_PARAMETERS = [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
] as const;

export function removeConnectionStringSslOptions(connectionString: string): string {
  const databaseUrl = new URL(connectionString);
  for (const parameter of SSL_CONNECTION_PARAMETERS) {
    databaseUrl.searchParams.delete(parameter);
  }
  return databaseUrl.toString();
}
