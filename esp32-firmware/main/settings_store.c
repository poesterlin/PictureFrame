#include "settings_store.h"

#include <string.h>

#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "settings_store";
static const char *NAMESPACE = "frame_cfg";

bool settings_store_init(void) {
	esp_err_t err = nvs_flash_init();
	if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
		ESP_ERROR_CHECK(nvs_flash_erase());
		err = nvs_flash_init();
	}
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "nvs init failed: %s", esp_err_to_name(err));
		return false;
	}
	return true;
}

static void set_defaults(frame_settings_t *settings) {
	memset(settings, 0, sizeof(*settings));
	strncpy(settings->device_id, "default", sizeof(settings->device_id) - 1);
	settings->refresh_every_seconds = 600;
}

bool settings_store_load(frame_settings_t *settings) {
	nvs_handle_t handle;
	set_defaults(settings);

	esp_err_t err = nvs_open(NAMESPACE, NVS_READONLY, &handle);
	if (err != ESP_OK) {
		ESP_LOGW(TAG, "no persisted settings yet");
		return true;
	}

	size_t size = sizeof(settings->device_id);
	err = nvs_get_str(handle, "device_id", settings->device_id, &size);
	if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) {
		ESP_LOGW(TAG, "failed loading device_id");
	}

	size = sizeof(settings->wifi_ssid);
	err = nvs_get_str(handle, "wifi_ssid", settings->wifi_ssid, &size);
	if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) {
		ESP_LOGW(TAG, "failed loading wifi_ssid");
	}

	size = sizeof(settings->wifi_password);
	err = nvs_get_str(handle, "wifi_pw", settings->wifi_password, &size);
	if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) {
		ESP_LOGW(TAG, "failed loading wifi_pw");
	}

	uint32_t refresh = settings->refresh_every_seconds;
	err = nvs_get_u32(handle, "refresh", &refresh);
	if (err == ESP_OK) {
		settings->refresh_every_seconds = refresh;
	}

	nvs_close(handle);
	return true;
}

bool settings_store_save(const frame_settings_t *settings) {
	nvs_handle_t handle;
	esp_err_t err = nvs_open(NAMESPACE, NVS_READWRITE, &handle);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "nvs open failed: %s", esp_err_to_name(err));
		return false;
	}

	ESP_ERROR_CHECK(nvs_set_str(handle, "device_id", settings->device_id));
	ESP_ERROR_CHECK(nvs_set_str(handle, "wifi_ssid", settings->wifi_ssid));
	ESP_ERROR_CHECK(nvs_set_str(handle, "wifi_pw", settings->wifi_password));
	ESP_ERROR_CHECK(nvs_set_u32(handle, "refresh", settings->refresh_every_seconds));
	ESP_ERROR_CHECK(nvs_commit(handle));
	nvs_close(handle);
	return true;
}
