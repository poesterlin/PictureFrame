#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
	uint8_t *data;
	size_t length;
} frame_payload_t;

// Sets the Bearer auth key included on subsequent artifact GETs. NULL or
// empty disables the Authorization header.
void frame_fetcher_set_auth_key(const char *auth_key);

bool frame_fetcher_download(const char *url, frame_payload_t *out_payload);
void frame_fetcher_free(frame_payload_t *payload);
