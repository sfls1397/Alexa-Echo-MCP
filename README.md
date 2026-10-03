# Alexa Echo MCP

A small MCP server that lets an AI assistant drive **your own** Amazon Echo
devices. It runs on a Mac as a LaunchAgent and exposes three tools:

| Tool | What it does |
| --- | --- |
| `alexa_speak` | Make a named Echo say a message out loud (up to 250 characters). |
| `alexa_run_routine` | Run an existing Alexa routine by its **exact** name, on a named Echo. |
| `alexa_text_command` | Send a command to a named Echo as if it had been spoken to it, e.g. "turn off the kitchen light" or "play jazz". |

That's all it does. There's no Drop In, calling, volume or playback control,
and no reading device state.

## ⚠️ Unofficial: read this first

Amazon has **no official API** for controlling Echo devices like this. This
package uses [alexa-remote2](https://github.com/Apollon77/alexa-remote), which
talks to the same private web/app endpoints the Alexa app uses, with a session
from your own Amazon sign-in.

- **It can break at any time.** When Amazon changes those endpoints, or
  expires or blocks the session, the tools fail until alexa-remote2 is updated
  or you sign in again.
- **The Echo's spoken reply doesn't come back.** A success result only means
  Amazon accepted the request. If you ask "what's the weather", the Echo says
  it out loud in the room and the caller gets nothing back.
- It isn't an Alexa skill, Home Assistant or a cloud automation service. It's
  one process on your Mac using your account.

## Requirements

- macOS (the Amazon session is kept in the login Keychain)
- Node.js 22.5+
- An Amazon account that owns the Echoes, with app-based 2-step verification
  (the older SMS/e-mail 2FA flow may not work with the sign-in proxy)

## Setup

```bash
npm install -g alexa-echo-mcp      # or: clone, npm install && npm run build
alexa-echo-mcp login
```

`login` serves a copy of Amazon's sign-in page on
`http://127.0.0.1:8427/` and opens it in your browser. Sign in there, on the
same Mac, in a desktop browser (a phone with the Alexa app installed may jump
into the app instead). When it finishes, the session is saved to the Keychain
(service `alexa-echo-mcp`, account `amazon-session`) and the command prints the
Echo names on the account.

Check it any time:

```bash
alexa-echo-mcp status
```

### Optional: your own names for the Echoes

By default callers use each Echo's name from the Alexa app. If you name them
differently elsewhere (say, in your router or another tool), map your names
to the Alexa app names in `~/.alexa-echo-mcp/config.json`:

```json
{
  "echoes": {
    "Upstairs Speaker": "Den Echo"
  }
}
```

Only names that really exist are accepted, either a mapped name or an Echo's
Alexa app name. The tools list the valid names in their `echo` argument and
reject anything else. See `examples/config.json.example` for every setting
(`serverPort` 8426, `loginPort` 8427, `amazonPage` e.g. `amazon.co.uk`,
`locale` e.g. `en-GB`).

### Run it as a LaunchAgent

```bash
sh examples/install-launchagent.sh "$(command -v node)"
```

This installs `com.alexa-echo-mcp.server` (KeepAlive). It serves Streamable
HTTP MCP on `0.0.0.0:8426/mcp`, logging to
`~/Library/Logs/alexa-echo-mcp.server.log`. Every request needs a bearer
token, generated on first start and kept in the Keychain (service
`alexa-echo-mcp-http`, account `http-auth-token`). Print it with:

```bash
alexa-echo-mcp http-token
```

The server reconnects to Amazon when the first tool call arrives, so you can
run `login` again while it's running.

## Connecting clients

HTTP clients (Claude Code or any client that speaks Streamable HTTP):

```json
{
  "mcpServers": {
    "alexa-echo": {
      "url": "http://127.0.0.1:8426/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

```bash
claude mcp add --transport http alexa-echo http://127.0.0.1:8426/mcp \
  -H "Authorization: Bearer <token>" -s user
```

Clients that only launch stdio servers can run `alexa-echo-mcp stdio` on the
same Mac, or `alexa-echo-mcp http-proxy http://<mac>.local:8426/mcp` with
`ALEXA_ECHO_MCP_TOKEN` set, from another machine on the LAN. Don't
port-forward 8426. For access away from home, use a VPN such as Tailscale.

## Security notes

- The Amazon session (refresh token and cookies) is equivalent to being signed
  in to your Alexa app. It's stored only in the Keychain. It's never written
  to config, logs or tool output, and alexa-remote2's verbose logger (which
  prints tokens) is never turned on.
- Your Amazon password is typed only into Amazon's own page, through the
  loopback proxy. This program never stores it.
- The session refreshes itself about every 4 days, and the refreshed session
  replaces the old one in the Keychain.
- `alexa-echo-mcp logout` deletes the saved session. To cut access from
  Amazon's side, remove the registered device from **Amazon account → Content
  & Devices → Devices**.
- `~/.alexa-echo-mcp/login-device.json` holds the sign-in proxy's random device
  ID, so repeated sign-ins reuse one registered device. It contains no password
  or token.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Not signed in to Amazon` | Run `alexa-echo-mcp login`. |
| `Amazon session no longer works` | Amazon expired or revoked it. Run `login` again. |
| Sign-in page shows "Sorry! Something went wrong!" | Use a normal desktop browser on the same Mac, at `127.0.0.1`, not another host name. |
| Requests accepted but nothing happens | Check the Echo is online in the Alexa app. For routines, check the name matches exactly, including capitals. |
| Everything fails after it used to work | Amazon probably changed its private API. Update this package (and alexa-remote2) and sign in again. |

## License

MIT. Alexa and Echo are trademarks of Amazon. This project isn't affiliated
with or endorsed by Amazon.
