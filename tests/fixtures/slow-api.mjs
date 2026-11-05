// Preloaded into the built CLI by tests/closed-pipe.test.ts. It stands in for
// a long-running command: when the CLI calls Teamwork, a first chunk goes to
// stdout, and the response arrives later, so the CLI writes again after the
// reader has gone. The first write happens inside fetch, not when this file
// loads, so the CLI's own stream handlers are already in place.
const tasks = Array.from({ length: 2000 }, (_, id) => ({ id, name: `Task ${id}` }));
globalThis.fetch = async () => {
  process.stdout.write("x".repeat(256 * 1024) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 300));
  return new Response(JSON.stringify({ tasks }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
