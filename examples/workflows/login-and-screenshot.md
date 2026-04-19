# Workflow: Login + Screenshot

A complete agent-driven scenario: launch an Electron app, authenticate,
and capture a screenshot of the post-login dashboard.

## Prerequisites

- `electron-mcp` server registered with your MCP client (see the main
  [README](../../README.md#2-register-the-server-with-your-mcp-client)).
- An Electron app with a login form at `/login` that redirects to
  `/dashboard` on success.
- The executable path is on your allowlist.

## Script the agent should follow

1. **Launch** the app.
2. **Wait** for the login window.
3. **Fill** email + password.
4. **Click** submit.
5. **Wait** for the dashboard window.
6. **Screenshot** the result.
7. **Close** the session.

## Tool calls (JSON-RPC)

### 1. Launch

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_launch",
    "arguments": {
      "executablePath": "/Applications/MyApp.app/Contents/MacOS/MyApp",
      "label": "login-flow"
    }
  }
}
```

Response → take `sessionId` from `result.content[0].text`.

### 2. Wait for login window

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_wait_for_window",
    "arguments": {
      "sessionId": "sess_…",
      "urlPattern": "/login",
      "timeout": 10000
    }
  }
}
```

### 3. Fill email

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_fill",
    "arguments": {
      "sessionId": "sess_…",
      "selector": "input[name='email']",
      "value": "user@example.com"
    }
  }
}
```

### 4. Fill password

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_fill",
    "arguments": {
      "sessionId": "sess_…",
      "selector": "input[name='password']",
      "value": "correct-horse-battery-staple"
    }
  }
}
```

### 5. Click submit

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_click",
    "arguments": {
      "sessionId": "sess_…",
      "selector": "button[type='submit']"
    }
  }
}
```

### 6. Wait for dashboard

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_wait_for_window",
    "arguments": {
      "sessionId": "sess_…",
      "urlPattern": "/dashboard",
      "timeout": 15000
    }
  }
}
```

### 7. Screenshot

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_screenshot",
    "arguments": {
      "sessionId": "sess_…",
      "path": "./screenshots/dashboard.png",
      "fullPage": true,
      "type": "png"
    }
  }
}
```

### 8. Close

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_close",
    "arguments": { "sessionId": "sess_…" }
  }
}
```

## What a correct trace looks like

Every successful step returns:

```json
{
  "ok": true,
  "sessionId": "sess_…",
  "…": "…tool-specific fields…"
}
```

If a window takes too long to appear, the wait step fails with:

```json
{
  "ok": false,
  "error": {
    "code": "window_not_found",
    "message": "No window matching: url~=/dashboard",
    "details": { "windowRef": "url~=/dashboard" }
  }
}
```

The agent should either retry once with a longer timeout or surface the
error rather than pushing forward.
