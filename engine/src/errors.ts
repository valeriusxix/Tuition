/** An error the user can fix (missing key, prerequisite step); the CLI prints only its message. */
export class UsageError extends Error {
  override name = "UsageError";
}
