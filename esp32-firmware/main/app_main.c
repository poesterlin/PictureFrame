#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "ble_provisioning.h"
#include "display_driver.h"
#include "frame_fetcher.h"
#include "frame_ws.h"
#include "settings_store.h"
#include "wifi_manager.h"

static const char *TAG = "pictureframe";
static frame_settings_t s_settings;

static const char *WS_BASE_URL = CONFIG_FRAME_WS_BASE_URL;
static const char *FRAME_BASE_URL = CONFIG_FRAME_ASSET_BASE_URL;

static bool starts_with(const char *value, const char *prefix) {
	return value != NULL && prefix != NULL && strncmp(value, prefix, strlen(prefix)) == 0;
}

static void build_artifact_url(char *out, size_t out_len, const char *artifact_key) {
	if (starts_with(artifact_key, "http://") || starts_with(artifact_key, "https://")) {
		snprintf(out, out_len, "%s", artifact_key);
		return;
	}
	if (starts_with(artifact_key, "/frames/")) {
		snprintf(out, out_len, "%s%s", FRAME_BASE_URL, artifact_key);
		return;
	}
	if (starts_with(artifact_key, "frames/")) {
		snprintf(out, out_len, "%s/%s", FRAME_BASE_URL, artifact_key);
		return;
	}
	if (artifact_key[0] == '/') {
		snprintf(out, out_len, "%s/frames%s", FRAME_BASE_URL, artifact_key);
		return;
	}
	snprintf(out, out_len, "%s/frames/%s", FRAME_BASE_URL, artifact_key);
}

static void apply_new_wifi_config(const frame_settings_t *settings) {
	if (!settings_store_save(settings)) {
		ESP_LOGE(TAG, "failed to persist settings");
		return;
	}
	ESP_LOGI(TAG, "wifi settings updated, restarting");
	vTaskDelay(pdMS_TO_TICKS(500));
	esp_restart();
}

static bool render_from_artifact_key(const char *artifact_key) {
	char url[320];
	build_artifact_url(url, sizeof(url), artifact_key);
	ESP_LOGI(TAG, "display update artifact=%s url=%s", artifact_key, url);

	frame_payload_t payload = {0};
	if (!frame_fetcher_download(url, &payload)) {
		ESP_LOGE(TAG, "frame download failed for artifact=%s", artifact_key);
		return false;
	}

	bool ok = display_driver_render_pf7a(payload.data, payload.length);
	frame_fetcher_free(&payload);
	return ok;
}

static void handle_command_payload(cJSON *root) {
	cJSON *refresh_every = cJSON_GetObjectItem(root, "refreshEvery");
	cJSON *reboot = cJSON_GetObjectItem(root, "reboot");
	cJSON *refresh_now = cJSON_GetObjectItem(root, "refreshNow");
	cJSON *sync_now = cJSON_GetObjectItem(root, "syncNow");

	if (cJSON_IsNumber(refresh_every) && refresh_every->valueint > 0) {
		s_settings.refresh_every_seconds = (uint32_t)refresh_every->valueint;
		settings_store_save(&s_settings);
	}
	if (cJSON_IsTrue(reboot)) {
		ESP_LOGW(TAG, "reboot command received");
		vTaskDelay(pdMS_TO_TICKS(250));
		esp_restart();
	}
	if (cJSON_IsTrue(refresh_now) || cJSON_IsTrue(sync_now)) {
		ESP_LOGI(TAG, "sync command requested");
	}
}

static void ws_message_handler(const char *payload, int payload_len) {
	char json[1024] = {0};
	int copy_len = payload_len < (int)sizeof(json) - 1 ? payload_len : (int)sizeof(json) - 1;
	memcpy(json, payload, copy_len);
	ESP_LOGI(TAG, "ws payload len=%d body=%s", payload_len, json);

	cJSON *root = cJSON_Parse(json);
	if (root == NULL) {
		ESP_LOGE(TAG, "invalid websocket payload");
		return;
	}

	cJSON *type = cJSON_GetObjectItem(root, "type");
	if (cJSON_IsString(type) && strcmp(type->valuestring, "display") == 0) {
		cJSON *artifact_key = cJSON_GetObjectItem(root, "artifactKey");
		if (cJSON_IsString(artifact_key)) {
			if (!render_from_artifact_key(artifact_key->valuestring)) {
				ESP_LOGE(TAG, "display update failed");
			}
		}
	}

	if (cJSON_IsString(type) && strcmp(type->valuestring, "command") == 0) {
		handle_command_payload(root);
	}

	cJSON_Delete(root);
}

static void refresh_task(void *arg) {
	(void)arg;
	while (true) {
		vTaskDelay(pdMS_TO_TICKS(s_settings.refresh_every_seconds * 1000));
		char state[96];
		snprintf(
			state,
			sizeof(state),
			"{\"type\":\"state\",\"status\":\"heartbeat\",\"refreshEvery\":%u}",
			(unsigned)s_settings.refresh_every_seconds
		);
		frame_ws_send(state);
	}
}

void app_main(void) {
	ESP_LOGI(TAG, "starting picture frame firmware");

	ESP_ERROR_CHECK(display_driver_init() ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(settings_store_init() ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(settings_store_load(&s_settings) ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(wifi_manager_init() ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(ble_provisioning_start(&s_settings, apply_new_wifi_config) ? ESP_OK : ESP_FAIL);

	if (strlen(s_settings.wifi_ssid) == 0) {
		ESP_LOGW(TAG, "wifi not provisioned yet");
		return;
	}

	ESP_ERROR_CHECK(wifi_manager_connect(s_settings.wifi_ssid, s_settings.wifi_password) ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(wifi_manager_wait_until_ready(20000) ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(frame_ws_init(WS_BASE_URL, s_settings.device_id, ws_message_handler) ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(frame_ws_start() ? ESP_OK : ESP_FAIL);
	ESP_LOGI(TAG, "connected to websocket as deviceId=%s", s_settings.device_id);

	xTaskCreate(refresh_task, "refresh_task", 4096, NULL, 5, NULL);
}
