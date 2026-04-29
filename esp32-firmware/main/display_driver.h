#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

bool display_driver_init(void);
bool display_driver_render_pf7a(const uint8_t *payload, size_t payload_len);
