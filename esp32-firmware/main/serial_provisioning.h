#pragma once

#include <stdbool.h>

#include "settings_store.h"

typedef void (*serial_wifi_update_handler_t)(const frame_settings_t *settings);

bool serial_provisioning_start(frame_settings_t *settings, serial_wifi_update_handler_t on_update);
void serial_provisioning_stop(void);
