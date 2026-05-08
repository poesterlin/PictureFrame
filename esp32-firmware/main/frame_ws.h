#pragma once

#include <stdbool.h>

typedef void (*ws_message_handler_t)(const char *payload, int payload_len);
typedef void (*ws_connected_handler_t)(void);

bool frame_ws_init(
	const char *base_ws_url,
	const char *auth_key,
	ws_message_handler_t handler,
	ws_connected_handler_t connected_handler
);
bool frame_ws_start(void);
bool frame_ws_stop(void);
