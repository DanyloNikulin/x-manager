# Windows station deployment

These scripts run X-Manager and its subscription worker under the same Windows
user that owns the Claude, Codex, and Kimi login sessions.

- `start-web.ps1` binds Next.js only to `127.0.0.1:3999`.
- `run-worker-loop.ps1` loads only the manager admin token from
  `.env.production.local` and runs one worker pass every five minutes.
- `install-tasks.ps1 -Start` registers both launchers with the interactive user
  token at sign-in. No account password is stored, and subscription CLIs retain
  access to that user's DPAPI/Credential Manager sessions. The tasks therefore
  require that user to have an active Windows desktop session after a reboot.

Expose the loopback web server to the tailnet on a dedicated HTTPS port without
replacing other Tailscale Serve routes:

```powershell
tailscale serve --https=8443 --bg http://127.0.0.1:3999
```

Keep `post_mode`, `inbound_reply_mode`, and `outbound_reply_mode` in
`orchestrator/config.toml` set to `draft` or `approval` until both X accounts
and the end-to-end approval flow have been verified.
