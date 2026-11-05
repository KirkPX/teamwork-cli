// Preloaded into the built CLI by tests/closed-pipe.test.ts. It stands in for
// a long-running command: one write to stdout now, and a Teamwork response
// that arrives later, so the CLI writes again after the reader has gone.
process.stdout.write("x".repeat(256 * 1024) + "\n");
const tasks = Array.from({ length: 2000 }, (_, id) => ({ id, name: `Task ${id}` }));
globalThis.fetch = async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return new Response(JSON.stringify({ tasks }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
