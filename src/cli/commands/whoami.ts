// `teamwork whoami` asks Teamwork who the stored key belongs to. `teamwork auth`
// only reads what is saved on this machine, so it cannot tell a working key from
// one Teamwork has revoked. This command can.

import { resolveConfig } from "../../config.js";
import { buildName, extractPerson, stringField } from "../../login/discover.js";
import { createClient } from "../client-helpers.js";
import { reporter } from "../output.js";

export async function whoamiCommand(opts: { json?: boolean } = {}): Promise<void> {
  const client = createClient(opts);
  const person = extractPerson(await client.me());
  const { siteName } = resolveConfig();

  const id = person.id ?? null;
  const name = buildName(person);
  const email = stringField(person, "email") ?? stringField(person, "email-address");

  reporter(opts).result(
    { siteName, id, name, email },
    [
      `Signed in to ${siteName}.teamwork.com`,
      `  Name:  ${name ?? "(not given)"}`,
      `  Email: ${email ?? "(not given)"}`,
      `  ID:    ${id ?? "(not given)"}`,
    ].join("\n")
  );
}
