/**
 * The login page served on loopback during `teamwork login`.
 *
 * Deliberately self-contained: no CDN scripts, no fonts, no external calls.
 * The page's only job is to catch a pasted token and hand it to the CLI.
 */
export function loginPage(opts: { nonce: string; siteName?: string }): string {
  const teamworkUrl = opts.siteName
    ? `https://${escapeAttr(opts.siteName)}.teamwork.com/`
    : "https://www.teamwork.com/launchpad/login";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect the Teamwork CLI</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; line-height: 1.5; }
  .card { background: #1e293b; border-radius: 16px; padding: 40px; max-width: 560px; width: 100%; }
  h1 { font-size: 24px; margin-bottom: 6px; }
  .sub { color: #94a3b8; font-size: 15px; margin-bottom: 28px; }
  ol { margin: 0 0 24px 20px; color: #cbd5e1; font-size: 15px; }
  li { margin-bottom: 8px; }
  .open-btn { display: inline-block; background: #334155; color: #e2e8f0; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; margin-bottom: 24px; }
  .open-btn:hover { background: #475569; }
  label { display: block; font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  input { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; padding: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  input:focus { outline: none; border-color: #3b82f6; }
  .field { margin-bottom: 18px; }
  .hidden { display: none; }
  button.primary { width: 100%; background: #3b82f6; color: white; border: none; padding: 13px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
  button.primary:hover { background: #2563eb; }
  button.primary:disabled { opacity: 0.6; cursor: wait; }
  #status { margin-top: 20px; padding: 14px; border-radius: 8px; font-size: 14px; }
  .progress { background: #1e3a5f; color: #93c5fd; }
  .success { background: #064e3b; color: #6ee7b7; }
  .error { background: #7f1d1d; color: #fca5a5; }
  .hint { margin-top: 8px; font-size: 13px; opacity: 0.85; }
  .note { color: #64748b; font-size: 13px; margin: -12px 0 22px; }
  .done h1 { margin-bottom: 12px; }
</style>
</head>
<body>
<div class="card" id="card">
  <h1>Connect the Teamwork CLI</h1>
  <p class="sub">Paste your Teamwork API token. It goes straight to the CLI on this machine and into your OS keychain — never to any other server.</p>

  <ol>
    <li>Open Teamwork and sign in.</li>
    <li>Click your profile picture: <strong>bottom left</strong>, or top right on older layouts.</li>
    <li>Choose <strong>Edit My Details</strong>.</li>
    <li>Open the <strong>API &amp; Mobile</strong> tab.</li>
    <li>Click <strong>Show your Token</strong> and copy it.</li>
  </ol>
  <p class="note">Teamwork has no direct link to that tab — it is a dialog, not
  a page — so these steps are the only route to the token. They work however you
  sign in to Teamwork: password, Google or single sign-on. If you cannot see
  <strong>API &amp; Mobile</strong>, ask your site administrator.</p>

  <a class="open-btn" href="${teamworkUrl}" target="_blank" rel="noreferrer">Open Teamwork &rarr;</a>

  <form id="form">
    <div class="field">
      <label for="apiKey">API token</label>
      <input id="apiKey" name="apiKey" autocomplete="off" spellcheck="false" placeholder="Paste your token" autofocus>
    </div>
    <div class="field hidden" id="siteField">
      <label for="siteName">Site name</label>
      <input id="siteName" name="siteName" autocomplete="off" spellcheck="false" placeholder="yoursite (the part before .teamwork.com)">
    </div>
    <button class="primary" id="submit" type="submit">Connect</button>
  </form>

  <div id="status"></div>
</div>

<script>
  var NONCE = ${JSON.stringify(opts.nonce)};
  var form = document.getElementById('form');
  var status = document.getElementById('status');
  var submit = document.getElementById('submit');
  var siteField = document.getElementById('siteField');

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var apiKey = document.getElementById('apiKey').value.trim();
    var siteName = document.getElementById('siteName').value.trim();

    if (!apiKey) {
      status.className = 'error';
      status.textContent = 'Paste your API token first.';
      return;
    }

    submit.disabled = true;
    status.className = 'progress';
    status.textContent = 'Checking the token with Teamwork...';

    fetch('/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey, siteName: siteName, nonce: NONCE })
    })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
      .then(function (result) {
        if (result.ok) {
          var who = result.body.userName || result.body.email || 'your account';
          document.getElementById('card').className = 'card done';
          document.getElementById('card').innerHTML =
            '<h1>Connected</h1>' +
            '<p class="sub">Signed in as ' + escapeHtml(who) + ' on ' +
            escapeHtml(result.body.siteName) + '.teamwork.com</p>' +
            '<div id="status" class="success">You can close this tab and return to your terminal.</div>';
          return;
        }
        throw new Error(result.body.error || 'The CLI rejected that token.');
      })
      .catch(function (err) {
        status.className = 'error';
        status.innerHTML = escapeHtml(err.message);
        if (/site/i.test(err.message)) {
          siteField.className = 'field';
        }
        status.innerHTML += '<div class="hint">Nothing was saved. Fix the value above and try again.</div>';
        submit.disabled = false;
      });
  });

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
</script>
</body>
</html>`;
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c]!;
  });
}
