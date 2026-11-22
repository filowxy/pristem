# Providers — the three built-in endpoints

BYOK only (N5): no bundled model access, no free tier. Keys come from the environment and
are never written to `config/kernel.json`.

`config/kernel.json` ships three endpoints. Each one is configured independently — its own
model, key variable, base URL and token ceiling — so switching endpoints also switches the
model the agent loop asks for.

| id | adapter (wire protocol) | default model | key env | endpoint |
|---|---|---|---|---|
| `openai-chat` | `openai-chat` — Chat Completions | `gpt-4o` | `OPENAI_API_KEY` | `https://api.openai.com/v1/chat/completions` |
| `openai-responses` | `openai-responses` — Responses API | `gpt-4.1` | `OPENAI_API_KEY` | `https://api.openai.com/v1/responses` |
| `anthropic-messages` | `anthropic-messages` — Messages API | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com/v1/messages` |

`provider.default` picks the one a round starts on.

## Switching at runtime

```bash
pristem --probe                     # status of every endpoint, then a live ping per key
pristem --provider anthropic-messages --once -m "hi"
pristem --stream --provider openai-responses --once -m "hi"
```

Inside the interactive CLI: `/provider` lists, `/provider <id>` switches. The switch is a
`set_provider` request over `pristem.ipc/v0.3`; the ack is `provider_changed`, and the next
round uses the new endpoint. Sessions are not restarted and no config is re-read.

## Adding a fourth endpoint

Any entry may point at a different host — a gateway, a proxy, a local server — by reusing an
adapter name:

```json
"openai-proxy": {
  "adapter": "openai-chat",
  "model": "qwen3-coder",
  "base_url": "http://127.0.0.1:8080/v1/chat/completions",
  "api_key_env": "PROXY_API_KEY"
}
```

`adapter` defaults to the map key. Unknown adapters and a `default` that has no enabled
endpoint are both hard boot errors, not silent fallbacks.

## Streaming

`provider.stream: true` (or `--stream`) makes the loop consume SSE and emit
`speech_delta` events while text arrives; the assembled response still feeds the five gates
and the answer gate unchanged, and native tool calls are rebuilt from their fragments
(OpenAI `delta.tool_calls`, Responses `function_call_arguments.delta`, Anthropic
`input_json_delta`). Off by default: scripted transports (the desktop demo) only produce
whole bodies, and a streamed round against them would answer with nothing.

If a transport cannot stream at all, the loop falls back to one blocking request rather than
failing the round.

## Verification without keys

```bash
cargo test -p pristem-provider            # four-tuple + stream assembly + registry
cargo test -p pristem-provider --test live_http   # real curl against a loopback server
cargo test -p pristem-core --test loop_http       # agent loop → curl → SSE → tool → answer
```

`live_http` proves the parts that unit tests cannot: that curl is spawned, that
`Authorization` / `x-api-key` / `anthropic-version` actually leave the process, that a 401
surfaces as `Http(401, …)` instead of "malformed JSON", and that SSE frames survive the pipe.
`loop_http` runs two rounds over real HTTP with a tool call in between.

Real connectivity needs a key; `pristem --probe` prints `MISSING` and exits non-zero when
none is present.

## Deliberately not here yet

Retry/backoff, key rotation, per-endpoint rate limits, and HTTP/2 multiplexing. The
transport is one `curl` process per request (`CurlTransport`); swapping in a native client
means implementing `Transport`, not touching the loop.
