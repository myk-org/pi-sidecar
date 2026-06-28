# HTTP Tool Executor Reference

The HTTP tool executor enables custom tools backed by HTTP requests. When a custom tool includes an `http` property in its configuration, the sidecar automatically wraps it with an executor that interpolates parameters into the HTTP request, applies security hardening, and returns the response body to the AI session.

See [Configuring Built-in and Custom Tools](configuring-tools.html) for a guide on adding custom tools to sessions.

---

## HttpToolConfig Schema

The `http` property on a custom tool entry defines how the HTTP request is constructed. Both camelCase and snake_case property names are accepted (camelCase takes precedence when both are present).

| Property | Type | Default | Required | Description |
|---|---|---|---|---|
| `method` | `"GET"` \| `"POST"` \| `"PUT"` \| `"DELETE"` \| `"PATCH"` | — | Yes | HTTP method for the request. |
| `url` | `string` | — | Yes | URL template. Supports `{paramName}` placeholders. |
| `headers` | `Record<string, string>` | `{}` | No | Header templates. Values support `{paramName}` placeholders. |
| `queryParams` / `query_params` | `Record<string, string>` | — | No | Query parameter templates appended to the URL. Values support `{paramName}` placeholders. |
| `bodyTemplate` / `body_template` | `Record<string, any>` \| `string` | — | No | Request body template. Supports `{paramName}` placeholders. |
| `timeoutMs` / `timeout_ms` | `number` | `30000` | No | Request timeout in milliseconds. |

### Minimal Example

```json
{
  "name": "get_user",
  "description": "Fetch a user by ID",
  "parameters": {
    "type": "object",
    "properties": {
      "userId": { "type": "string" }
    }
  },
  "http": {
    "method": "GET",
    "url": "https://api.example.com/users/{userId}"
  }
}
```

### Full Example

```json
{
  "name": "create_item",
  "description": "Create an item in the inventory",
  "parameters": {
    "type": "object",
    "properties": {
      "itemName": { "type": "string" },
      "itemCount": { "type": "number" },
      "token": { "type": "string" }
    }
  },
  "http": {
    "method": "POST",
    "url": "https://api.example.com/items",
    "headers": {
      "Authorization": "Bearer {token}",
      "X-Request-Id": "{reqId}"
    },
    "query_params": {
      "format": "json"
    },
    "body_template": {
      "name": "{itemName}",
      "count": "{itemCount}",
      "active": true
    },
    "timeout_ms": 10000
  }
}
```

---

## Parameter Interpolation

Placeholders use the `{paramName}` syntax. The AI agent provides parameter values at call time based on the tool's `parameters` schema.

### Interpolation Rules

| Scenario | Behavior |
|---|---|
| Placeholder matches a string parameter | Replaced with the string value |
| Placeholder matches a number/boolean parameter | Replaced with `JSON.stringify(value)` |
| Placeholder matches an object parameter | Replaced with the JSON-serialized object |
| Placeholder has no matching parameter | Left as-is (e.g., `{unknown}` remains `{unknown}`) |
| Same placeholder appears multiple times | Each occurrence is replaced independently |

```
Template: "{greeting} {name}!"
Params:   { "greeting": "Hi", "name": "Alice" }
Result:   "Hi Alice!"
```

```
Template: "count={n}"
Params:   { "n": 42 }
Result:   "count=42"
```

```
Template: "{x}+{x}={y}"
Params:   { "x": "1", "y": "2" }
Result:   "1+1=2"
```

### Where Interpolation Applies

Interpolation is applied in four locations, each with context-specific escaping:

| Location | Escaping Applied | Details |
|---|---|---|
| URL path (`url`) | URI encoding (`encodeURIComponent`) | String parameter values are URI-encoded before interpolation |
| Query parameters (`queryParams`) | `URLSearchParams` encoding | Raw parameter values are interpolated, then `URLSearchParams` handles URL encoding |
| Headers (`headers`) | CRLF stripping | CR (`\r`) and LF (`\n`) characters are removed after interpolation |
| Body — string template (`bodyTemplate` as `string`) | None | Raw interpolation with no escaping |
| Body — object template (`bodyTemplate` as `object`) | JSON escaping | String parameter values are JSON-escaped (e.g., `"` → `\"`) before interpolation |

---

## Security Hardening

### URI Encoding in URL Paths

String parameter values interpolated into the `url` template are passed through `encodeURIComponent()` before substitution. This prevents path traversal and URL injection.

```
URL template: "https://api.example.com/users/{userId}/profile"
Param value:  { "userId": "../../admin" }
Result URL:   "https://api.example.com/users/..%2F..%2Fadmin/profile"
```

```
URL template: "https://api.example.com/items/{name}"
Param value:  { "name": "foo bar/baz?x=1&y=2#frag" }
Result URL:   "https://api.example.com/items/foo%20bar%2Fbaz%3Fx%3D1%26y%3D2%23frag"
```

> **Note:** URI encoding applies only to the URL path. Query parameter values go through `URLSearchParams`, which handles its own encoding. Body and header values use different escaping strategies.

### URL Scheme Validation

Only `http:` and `https:` URL schemes are permitted. Requests to other schemes (e.g., `file:`, `ftp:`, `data:`) are blocked before `fetch` is called.

```
URL: "file:///etc/passwd"
Result: "HTTP request failed: Unsupported URL scheme 'file:' — only http: and https: are allowed"
```

Invalid URLs that cannot be parsed return:

```
URL: "not-a-url"
Result: "HTTP request failed: Invalid URL"
```

> **Warning:** Host allowlisting and private-network blocking are **not implemented**. Callers are responsible for restricting target hosts if needed.

### CRLF Stripping in Headers

After interpolation, all CR (`\r`) and LF (`\n`) characters are stripped from header values to prevent CRLF header injection.

```
Header template: { "X-Custom": "value-{injected}" }
Param value:     { "injected": "legit\r\nX-Evil: injected" }
Result header:   { "X-Custom": "value-legitX-Evil: injected" }
```

### JSON Escaping in Object Body Templates

When `bodyTemplate` is an object (not a string), string parameter values are JSON-escaped before interpolation. This prevents JSON injection through values containing quotes, backslashes, or control characters.

```
Body template: { "name": "{itemName}", "type": "widget" }
Param value:   { "itemName": "foo\"bar" }
Result body:   {"name":"foo\"bar","type":"widget"}   ← valid JSON
```

```
Body template: { "path": "{filePath}" }
Param value:   { "filePath": "C:\\Users\\test\t\"hello\"\nnewline" }
Result body:   ← valid JSON, all special characters properly escaped
```

> **Note:** String body templates (`bodyTemplate` as a plain string) do **not** apply JSON escaping. Use object templates when the body must be valid JSON.

### Log Injection Prevention

URL templates logged in error messages are sanitized by stripping CR/LF characters. Query strings are redacted from logged URLs (only origin + pathname are included).

---

## Content-Type Handling

| Condition | Behavior |
|---|---|
| `bodyTemplate` is defined and no `Content-Type` header is set | `Content-Type: application/json` is added automatically |
| `bodyTemplate` is defined and `Content-Type` header exists | Existing header is preserved (case-insensitive check) |
| `bodyTemplate` is `undefined` | No `Content-Type` header is added, no body is sent |

```json
{
  "http": {
    "method": "POST",
    "url": "https://api.example.com/items",
    "headers": { "Content-Type": "text/plain" },
    "body_template": "raw text {data}"
  }
}
```

The custom `text/plain` header is preserved; the default `application/json` is not applied.

---

## Query Parameter Handling

Query parameters defined in `queryParams` are appended to the URL after interpolation. `URLSearchParams` handles value encoding.

| URL State | Separator Used |
|---|---|
| URL has no existing query string | `?` |
| URL already contains `?` | `&` |
| URL contains a fragment (`#`) | Query params inserted before the fragment |

```
URL:          "https://api.example.com/search?base=true"
queryParams:  { "q": "{query}" }
Params:       { "query": "hello" }
Result:       "https://api.example.com/search?base=true&q=hello"
```

```
URL:          "https://api.example.com/docs#section"
queryParams:  { "q": "{query}" }
Params:       { "query": "test" }
Result:       "https://api.example.com/docs?q=test#section"
```

---

## Timeouts

| Setting | Value |
|---|---|
| Default timeout | 30,000 ms (30 seconds) |
| Configurable via | `timeoutMs` / `timeout_ms` in `HttpToolConfig` |
| Mechanism | `AbortController` with `setTimeout` |

When a request exceeds the timeout, the executor returns an error string:

```
HTTP request failed: Request timed out after 50ms
```

### External Abort Signal

The executor accepts an optional `AbortSignal` (passed by the Pi SDK when a session is aborted). If the signal is already aborted when the executor is called, the request is skipped immediately:

```
HTTP request failed: Request aborted
```

If the signal fires during the request:

```
HTTP request failed: Request aborted
```

---

## Response Handling

### Response Size Limit

| Setting | Value |
|---|---|
| Maximum response size | 1,048,576 bytes (1 MB) |
| Behavior on overflow | Response body is truncated; a warning is logged |

The response body is read incrementally using a streaming reader. When the accumulated size exceeds 1 MB, reading stops and only the bytes within the limit are returned.

### Error Responses

The executor never throws exceptions. All errors are returned as strings.

| Condition | Return Value Format |
|---|---|
| HTTP error status (4xx, 5xx) | `HTTP {status}: {response_body}` |
| Network failure | `HTTP request failed: {error_message}` |
| Timeout | `HTTP request failed: Request timed out after {N}ms` |
| Aborted | `HTTP request failed: Request aborted` |
| Blocked URL scheme | `HTTP request failed: Unsupported URL scheme '{scheme}' — only http: and https: are allowed` |
| Invalid URL | `HTTP request failed: Invalid URL` |

```
"HTTP 404: Not Found"
"HTTP request failed: Connection refused"
"HTTP request failed: Request timed out after 30000ms"
```

### Successful Responses

On a 2xx status, the executor returns the raw response body as a string.

---

## Wire Format Normalization

The `normalizeHttpToolConfig()` function converts snake_case JSON keys (from Python or curl callers) to the internal camelCase interface. Both formats are accepted.

| Wire Format (snake_case) | Internal (camelCase) |
|---|---|
| `query_params` | `queryParams` |
| `body_template` | `bodyTemplate` |
| `timeout_ms` | `timeoutMs` |

When both forms are present, **camelCase takes precedence**.

```json
{
  "method": "POST",
  "url": "https://api.example.com/items",
  "query_params": { "format": "json" },
  "body_template": { "name": "{itemName}" },
  "timeout_ms": 5000
}
```

Is equivalent to:

```json
{
  "method": "POST",
  "url": "https://api.example.com/items",
  "queryParams": { "format": "json" },
  "bodyTemplate": { "name": "{itemName}" },
  "timeoutMs": 5000
}
```

---

## SDK Integration

When a session is created via `POST /sessions` with a `custom_tools` entry containing an `http` property, the sidecar automatically:

1. Normalizes the `http` config (snake_case → camelCase).
2. Creates an HTTP executor via `createHttpToolExecutor()`.
3. Wraps it in a Pi SDK–compatible tool definition with the signature `execute(toolCallId, params, signal)`.
4. Returns results in the SDK's `AgentToolResult` format: `{ content: [{ type: "text", text }], details: {} }`.
5. Adds the tool name to the session's allowed tool list.

See [REST API Reference](rest-api-reference.html) for the `POST /sessions` request schema and [Configuring Built-in and Custom Tools](configuring-tools.html) for usage patterns.

---

## Exported API (TypeScript)

All exports are named exports from `@myk-org/pi-sidecar` (re-exported via `src/index.ts`).

### `createHttpToolExecutor(httpConfig)`

Creates an async executor function for an HTTP-backed tool.

| Parameter | Type | Description |
|---|---|---|
| `httpConfig` | `HttpToolConfig` | HTTP request configuration with templates |

**Returns:** `(params: Record<string, any>, externalSignal?: AbortSignal) => Promise<string>`

```typescript
import { createHttpToolExecutor } from "@myk-org/pi-sidecar";

const executor = createHttpToolExecutor({
  method: "GET",
  url: "https://api.example.com/users/{userId}",
  timeoutMs: 5000,
});

const result = await executor({ userId: "123" });
```

### `normalizeHttpToolConfig(raw)`

Converts a wire-format config object (snake_case or camelCase) to the internal `HttpToolConfig` interface.

| Parameter | Type | Description |
|---|---|---|
| `raw` | `Record<string, any>` | Raw config object from JSON input |

**Returns:** `HttpToolConfig`

```typescript
import { normalizeHttpToolConfig } from "@myk-org/pi-sidecar";

const config = normalizeHttpToolConfig({
  method: "POST",
  url: "https://api.example.com/items",
  body_template: { name: "{itemName}" },
  timeout_ms: 10000,
});
// config.bodyTemplate → { name: "{itemName}" }
// config.timeoutMs → 10000
```

### `interpolate(template, params)`

Replaces `{paramName}` placeholders in a string with values from a params object.

| Parameter | Type | Description |
|---|---|---|
| `template` | `string` | String containing `{paramName}` placeholders |
| `params` | `Record<string, any>` | Key-value map of parameter values |

**Returns:** `string`

> **Note:** This is the raw interpolation function with no escaping. The executor applies context-specific escaping (URI encoding, CRLF stripping, JSON escaping) before calling `interpolate()`.

```typescript
import { interpolate } from "@myk-org/pi-sidecar";

interpolate("Hello {name}!", { name: "World" });
// → "Hello World!"

interpolate("{a} and {b}", { a: "yes" });
// → "yes and {b}"
```

## Related Pages

- [Configuring Built-in and Custom Tools](configuring-tools.html)
- [REST API Reference](rest-api-reference.html)
- [Configuration and Environment Variables](configuration-reference.html)
- [REST API Recipes](recipes-rest-api.html)