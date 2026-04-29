#pragma once

#include <stdbool.h>

typedef void (*ws_message_handler_t)(const char *payload, int payload_len);

bool frame_ws_init(const char *base_ws_url, const char *device_id, ws_message_handler_t handler);
bool frame_ws_start(void);
bool frame_ws_send(const char *json_payload);
