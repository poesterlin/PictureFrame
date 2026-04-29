#pragma once

#include <stdbool.h>

#include "settings_store.h"

typedef void (*ble_wifi_update_handler_t)(const frame_settings_t *settings);

bool ble_provisioning_start(frame_settings_t *settings, ble_wifi_update_handler_t on_update);
