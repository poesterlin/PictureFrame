#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef struct {
	char device_id[32];
	char wifi_ssid[64];
	char wifi_password[64];
	uint32_t refresh_every_seconds;
} frame_settings_t;

bool settings_store_init(void);
bool settings_store_load(frame_settings_t *settings);
bool settings_store_save(const frame_settings_t *settings);
