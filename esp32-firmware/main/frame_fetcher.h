#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
	uint8_t *data;
	size_t length;
} frame_payload_t;

bool frame_fetcher_download(const char *url, frame_payload_t *out_payload);
void frame_fetcher_free(frame_payload_t *payload);
