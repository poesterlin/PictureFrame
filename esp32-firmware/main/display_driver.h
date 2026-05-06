#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

bool display_driver_init(void);
bool display_driver_render_pf7a(const uint8_t *payload, size_t payload_len);
bool display_driver_render_pf7a_url(const char *url);
bool display_driver_render_packed_7color(const uint8_t *packed_buffer, size_t packed_len);
bool display_driver_render_checkerboard(void);
bool display_driver_render_solid_test(uint8_t color);
