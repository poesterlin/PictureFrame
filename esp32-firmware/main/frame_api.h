#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Initializes the polling client with the HTTP base URL (e.g.
// "https://frame.example.com") and the per-frame Bearer auth key. Both
// strings must remain valid for the lifetime of the process.
bool frame_api_init(const char *base_url, const char *auth_key);

// Performs POST /api/frame/hello with the supplied JSON body. Returns a
// freshly heap-allocated, NUL-terminated response (caller frees) or NULL on
// failure.
char *frame_api_hello(const char *json_body);

// Performs GET /api/frame/snapshot. Caller frees the returned string.
char *frame_api_snapshot(void);

// Performs GET /api/frame/events?after=<after>&wait=<wait_ms>. Caller frees
// the returned string.
char *frame_api_events(int64_t after, uint32_t wait_ms);

// Performs POST /api/frame/ack with body {"cursor": <cursor>}.
bool frame_api_ack(int64_t cursor);

// Performs POST /api/frame/state with the supplied JSON body. Used for
// periodic heartbeats.
bool frame_api_state(const char *json_body);
