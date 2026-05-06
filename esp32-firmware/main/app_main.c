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

extern const uint8_t _binary_known_frame_800x480_packed_bin_start[];
extern const uint8_t _binary_known_frame_800x480_packed_bin_end[];

static const char *WS_BASE_URL = CONFIG_FRAME_WS_BASE_URL;
static const char *FRAME_BASE_URL = CONFIG_FRAME_ASSET_BASE_URL;
static const int WIFI_READY_WAIT_MS = 60000;

typedef struct {
	char artifact_key[256];
} render_task_arg_t;

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

	if (!display_driver_render_pf7a_url(url)) {
		ESP_LOGE(TAG, "frame render failed for artifact=%s", artifact_key);
		return false;
	}
	return true;
}

static void render_task(void *arg) {
	render_task_arg_t *task_arg = (render_task_arg_t *)arg;
	if (!render_from_artifact_key(task_arg->artifact_key)) {
		ESP_LOGE(TAG, "display update failed");
	}
	free(task_arg);
	vTaskDelete(NULL);
}

static void schedule_render_from_artifact_key(const char *artifact_key) {
	render_task_arg_t *task_arg = calloc(1, sizeof(*task_arg));
	if (task_arg == NULL) {
		ESP_LOGE(TAG, "failed to allocate render task");
		return;
	}
	strncpy(task_arg->artifact_key, artifact_key, sizeof(task_arg->artifact_key) - 1);
	if (xTaskCreate(render_task, "render_task", 8192, task_arg, 5, NULL) != pdPASS) {
		ESP_LOGE(TAG, "failed to start render task");
		free(task_arg);
	}
}

static void handle_display_payload(cJSON *display) {
	cJSON *artifact_key = cJSON_GetObjectItem(display, "artifactKey");
	if (!cJSON_IsString(artifact_key)) {
		ESP_LOGW(TAG, "display payload missing artifactKey");
		return;
	}
	schedule_render_from_artifact_key(artifact_key->valuestring);
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
		handle_display_payload(root);
	}

	if (cJSON_IsString(type) && strcmp(type->valuestring, "command") == 0) {
		handle_command_payload(root);
	}

	if (cJSON_IsString(type) && strcmp(type->valuestring, "helloAck") == 0) {
		cJSON *pending = cJSON_GetObjectItem(root, "pending");
		cJSON *display = cJSON_IsObject(pending) ? cJSON_GetObjectItem(pending, "display") : NULL;
		if (cJSON_IsObject(display)) {
			ESP_LOGI(TAG, "rendering pending display from helloAck");
			handle_display_payload(display);
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

static void render_known_frame_once(void) {
	const uint8_t *start = _binary_known_frame_800x480_packed_bin_start;
	const uint8_t *end = _binary_known_frame_800x480_packed_bin_end;
	size_t len = (size_t)(end - start);
	ESP_LOGI(TAG, "rendering embedded known frame (%u bytes)", (unsigned)len);
	if (!display_driver_render_packed_7color(start, len)) {
		ESP_LOGE(TAG, "embedded known frame render failed");
		return;
	}
	ESP_LOGI(TAG, "embedded known frame render complete");
}

static void run_boot_render_diagnostics(void) {
	ESP_LOGW(TAG, "boot render diagnostics: solid black");
	display_driver_render_solid_test(0);
	vTaskDelay(pdMS_TO_TICKS(4000));

	ESP_LOGW(TAG, "boot render diagnostics: checkerboard");
	display_driver_render_checkerboard();
	vTaskDelay(pdMS_TO_TICKS(4000));

	ESP_LOGW(TAG, "boot render diagnostics: embedded known frame");
	render_known_frame_once();
	vTaskDelay(pdMS_TO_TICKS(20000));
}

void app_main(void) {
	ESP_LOGI(TAG, "starting picture frame firmware");

	bool display_ready = display_driver_init();
	if (!display_ready) {
		ESP_LOGE(TAG, "display init failed, continuing without panel output");
	} else {
		run_boot_render_diagnostics();
	}
	ESP_ERROR_CHECK(settings_store_init() ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(settings_store_load(&s_settings) ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(wifi_manager_init() ? ESP_OK : ESP_FAIL);

	if (strlen(s_settings.wifi_ssid) == 0) {
		ESP_ERROR_CHECK(ble_provisioning_start(&s_settings, apply_new_wifi_config) ? ESP_OK : ESP_FAIL);
		ESP_LOGW(TAG, "wifi not provisioned yet");
		return;
	}

	ESP_ERROR_CHECK(wifi_manager_connect(s_settings.wifi_ssid, s_settings.wifi_password) ? ESP_OK : ESP_FAIL);
	while (!wifi_manager_wait_until_ready(WIFI_READY_WAIT_MS)) {
		ESP_LOGW(TAG, "wifi not ready after %ds, still waiting", WIFI_READY_WAIT_MS / 1000);
		if (display_ready && !display_driver_render_checkerboard()) {
			ESP_LOGW(TAG, "timeout checkerboard render failed");
		}
	}
	ESP_ERROR_CHECK(frame_ws_init(WS_BASE_URL, s_settings.device_id, ws_message_handler) ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(frame_ws_start() ? ESP_OK : ESP_FAIL);
	ESP_LOGI(TAG, "connected to websocket as deviceId=%s", s_settings.device_id);

	xTaskCreate(refresh_task, "refresh_task", 4096, NULL, 5, NULL);
}
