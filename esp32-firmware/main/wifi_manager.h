#pragma once

#include <stdbool.h>

bool wifi_manager_init(void);
bool wifi_manager_connect(const char *ssid, const char *password);
bool wifi_manager_wait_until_ready(int timeout_ms);
