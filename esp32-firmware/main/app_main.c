#include <stdio.h>
#include <stdlib.h>
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
static const int WIFI_READY_WAIT_MS = 60000;

static bool render_from_artifact_key(const char *artifact_key);

static volatile bool s_render_in_progress;
static char s_last_display_request_id[64];
static char s_last_display_artifact[320];

static void display_update_task(void *arg) {
	char *artifact_key = (char *)arg;
	frame_ws_stop();
	if (artifact_key != NULL) {
		if (!render_from_artifact_key(artifact_key)) {
			ESP_LOGE(TAG, "display update failed");
		}
		free(artifact_key);
	}
	frame_ws_start();
	s_render_in_progress = false;
	vTaskDelete(NULL);
}

static void request_display_update(const char *artifact_key) {
	if (artifact_key == NULL || artifact_key[0] == '\0') {
		return;
	}
	if (s_render_in_progress) {
		ESP_LOGW(TAG, "display update already in progress, ignoring duplicate request");
		return;
	}

	size_t len = strlen(artifact_key);
	char *copy = (char *)malloc(len + 1);
	if (copy == NULL) {
		ESP_LOGE(TAG, "failed to allocate display request");
		return;
	}
	memcpy(copy, artifact_key, len + 1);

	s_render_in_progress = true;
	BaseType_t ok = xTaskCreate(display_update_task, "display_update", 8192, copy, 5, NULL);
	if (ok != pdPASS) {
		ESP_LOGE(TAG, "failed to start display update task");
		free(copy);
		s_render_in_progress = false;
		return;
	}
}

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

	if (display_driver_render_pf7a_url(url)) {
		return true;
	}

	ESP_LOGW(TAG, "streaming render failed, falling back to buffered download");
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

static void handle_display_payload(cJSON *display_obj) {
	cJSON *artifact_key = cJSON_GetObjectItem(display_obj, "artifactKey");
	cJSON *request_id = cJSON_GetObjectItem(display_obj, "requestId");

	if (!cJSON_IsString(artifact_key) || artifact_key->valuestring == NULL) {
		return;
	}

	if (cJSON_IsString(request_id) && request_id->valuestring != NULL) {
		if (strcmp(request_id->valuestring, s_last_display_request_id) == 0) {
			ESP_LOGI(TAG, "ignoring duplicate display requestId=%s", request_id->valuestring);
			return;
		}
		snprintf(s_last_display_request_id, sizeof(s_last_display_request_id), "%s", request_id->valuestring);
	} else {
		if (strcmp(artifact_key->valuestring, s_last_display_artifact) == 0) {
			ESP_LOGI(TAG, "ignoring duplicate display artifact=%s", artifact_key->valuestring);
			return;
		}
	}

	snprintf(s_last_display_artifact, sizeof(s_last_display_artifact), "%s", artifact_key->valuestring);
	request_display_update(artifact_key->valuestring);

	if (cJSON_IsString(request_id) && request_id->valuestring != NULL) {
		ESP_LOGI(TAG, "accepted display requestId=%s", request_id->valuestring);
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
		handle_display_payload(root);
	}

	if (cJSON_IsString(type) && strcmp(type->valuestring, "command") == 0) {
		handle_command_payload(root);
	}

	if (cJSON_IsString(type) && strcmp(type->valuestring, "helloAck") == 0) {
		cJSON *pending = cJSON_GetObjectItem(root, "pending");
		if (cJSON_IsObject(pending)) {
			cJSON *display = cJSON_GetObjectItem(pending, "display");
			if (cJSON_IsObject(display)) {
				ESP_LOGI(TAG, "processing pending display from helloAck");
				handle_display_payload(display);
			}
		}
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

	bool display_ready = display_driver_init();
	if (!display_ready) {
		ESP_LOGE(TAG, "display init failed, continuing without panel output");
	}
	ESP_ERROR_CHECK(settings_store_init() ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(settings_store_load(&s_settings) ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(wifi_manager_init() ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(ble_provisioning_start(&s_settings, apply_new_wifi_config) ? ESP_OK : ESP_FAIL);

	if (strlen(s_settings.wifi_ssid) == 0) {
		ESP_LOGW(TAG, "wifi not provisioned yet");
		return;
	}

	ESP_ERROR_CHECK(wifi_manager_connect(s_settings.wifi_ssid, s_settings.wifi_password) ? ESP_OK : ESP_FAIL);
	while (!wifi_manager_wait_until_ready(WIFI_READY_WAIT_MS)) {
		ESP_LOGW(TAG, "wifi not ready after %ds, still waiting", WIFI_READY_WAIT_MS / 1000);
	}
	ESP_ERROR_CHECK(frame_ws_init(WS_BASE_URL, ws_message_handler) ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(frame_ws_start() ? ESP_OK : ESP_FAIL);
	ESP_LOGI(TAG, "connected to websocket");

	xTaskCreate(refresh_task, "refresh_task", 4096, NULL, 5, NULL);
}
