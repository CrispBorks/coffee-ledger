/** What the Neon HTTP driver puts on the wire, reimplemented so `api/` can be
 *  run against a local Postgres in tests: numbered placeholders, and every
 *  value rendered as text for Postgres to infer a type for.
 *
 *  That last part is the one that matters. `starred` crosses as "true" and a
 *  timestamp as "1700000000000", so a stub passing JavaScript numbers would go
 *  green while `to_timestamp($n / 1000.0)` took its chances on the deployment.
 *
 *  neon-contract.test.ts holds this against the real client. */
export function toQuery(strings: TemplateStringsArray, values: unknown[]) {
  return {
    query: strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
      "",
    ),
    params: values.map((value) =>
      value === null || value === undefined
        ? null
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value),
    ),
  };
}
