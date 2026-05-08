#include <inttypes.h>
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
#include "frame_api.h"
#include "frame_fetcher.h"
#include "frame_ws.h"
#include "settings_store.h"
#include "wifi_manager.h"

static const char *TAG = "pictureframe";
static frame_settings_t s_settings;

static const char *WS_BASE_URL = CONFIG_FRAME_WS_BASE_URL;
static const char *FRAME_BASE_URL = CONFIG_FRAME_ASSET_BASE_URL;
static const char *FRAME_AUTH_KEY_FALLBACK = CONFIG_FRAME_AUTH_KEY;
static const int WIFI_READY_WAIT_MS = 60000;
// Heartbeat cadence is fixed; image rotation cadence is decided server-side.
static const uint32_t HEARTBEAT_INTERVAL_SECONDS = 60;

static volatile bool s_render_in_progress;
static char s_last_display_request_id[64];
static char s_last_display_artifact[320];
static int64_t s_last_cursor;

static bool render_from_artifact_key(const char *artifact_key);
static void send_hello_request(void);
static void process_event_envelope(cJSON *envelope);
static void process_message(cJSON *message);
static void apply_snapshot_payload(cJSON *snapshot);
static void poll_events_until_idle(uint32_t wait_ms);

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

static void process_message(cJSON *message) {
	if (!cJSON_IsObject(message)) {
		return;
	}
	cJSON *type = cJSON_GetObjectItem(message, "type");
	if (!cJSON_IsString(type) || type->valuestring == NULL) {
		return;
	}
	if (strcmp(type->valuestring, "display") == 0) {
		handle_display_payload(message);
	} else if (strcmp(type->valuestring, "command") == 0) {
		handle_command_payload(message);
	}
}

// Server pushes events as `{ cursor, message }`. Apply the message and
// advance our cursor; ACK afterwards so server-side pendingCommands shrink.
static void process_event_envelope(cJSON *envelope) {
	if (!cJSON_IsObject(envelope)) {
		return;
	}
	cJSON *cursor = cJSON_GetObjectItem(envelope, "cursor");
	cJSON *message = cJSON_GetObjectItem(envelope, "message");
	process_message(message);
	if (cJSON_IsNumber(cursor)) {
		int64_t value = (int64_t)cursor->valuedouble;
		if (value > s_last_cursor) {
			s_last_cursor = value;
		}
		frame_api_ack(value);
	}
}

// Snapshot shape (per server channel.getSnapshot):
//   { display: <DisplayUpdateMessage|null>, commands: <DeviceCommandMessage[]>, cursor: <number> }
static void apply_snapshot_payload(cJSON *snapshot) {
	if (!cJSON_IsObject(snapshot)) {
		return;
	}

	cJSON *display = cJSON_GetObjectItem(snapshot, "display");
	if (cJSON_IsObject(display)) {
		handle_display_payload(display);
	}

	cJSON *commands = cJSON_GetObjectItem(snapshot, "commands");
	if (cJSON_IsArray(commands)) {
		cJSON *command = NULL;
		cJSON_ArrayForEach(command, commands) {
			if (cJSON_IsObject(command)) {
				handle_command_payload(command);
			}
		}
	}

	cJSON *cursor = cJSON_GetObjectItem(snapshot, "cursor");
	if (cJSON_IsNumber(cursor)) {
		int64_t value = (int64_t)cursor->valuedouble;
		if (value > s_last_cursor) {
			s_last_cursor = value;
		}
		// Acknowledge so any commands present in the snapshot are cleared.
		frame_api_ack(value);
	}
}

// Performs POST /api/frame/hello, processes returned snapshot.
static void send_hello_request(void) {
	cJSON *root = cJSON_CreateObject();
	if (root == NULL) {
		ESP_LOGE(TAG, "failed to create hello payload");
		return;
	}

	cJSON_AddNumberToObject(root, "protocolVersion", 2);
	cJSON_AddNumberToObject(root, "heartbeatEvery", (double)HEARTBEAT_INTERVAL_SECONDS);

	char *json = cJSON_PrintUnformatted(root);
	cJSON_Delete(root);
	if (json == NULL) {
		ESP_LOGE(TAG, "failed to serialize hello payload");
		return;
	}

	char *response = frame_api_hello(json);
	free(json);
	if (response == NULL) {
		ESP_LOGW(TAG, "hello request failed");
		return;
	}

	cJSON *snapshot = cJSON_Parse(response);
	free(response);
	if (snapshot == NULL) {
		ESP_LOGW(TAG, "invalid hello response");
		return;
	}
	apply_snapshot_payload(snapshot);
	cJSON_Delete(snapshot);
}

// Drains any pending events the WS may have missed (or any initial events
// not bundled into the hello snapshot).
static void poll_events_until_idle(uint32_t wait_ms) {
	for (int i = 0; i < 4; ++i) {
		char *response = frame_api_events(s_last_cursor, wait_ms);
		if (response == NULL) {
			return;
		}

		cJSON *root = cJSON_Parse(response);
		free(response);
		if (root == NULL) {
			return;
		}

		cJSON *events = cJSON_GetObjectItem(root, "events");
		bool had_any = false;
		if (cJSON_IsArray(events)) {
			cJSON *envelope = NULL;
			cJSON_ArrayForEach(envelope, events) {
				process_event_envelope(envelope);
				had_any = true;
			}
		}
		cJSON_Delete(root);
		if (!had_any) {
			return;
		}
	}
}

static void ws_connected_handler(void) {
	// Push-only socket. The initial HTTP `hello` already ran before WS started,
	// so any current display/commands are applied. Live events arrive via WS.
	// Catch-up of missed events happens from the heartbeat task, which can
	// safely pause the WS to free TLS heap for the HTTP catch-up call.
	ESP_LOGI(TAG, "ws connected (push-only)");
}

static void ws_message_handler(const char *payload, int payload_len) {
	char json[2048] = {0};
	int copy_len = payload_len < (int)sizeof(json) - 1 ? payload_len : (int)sizeof(json) - 1;
	memcpy(json, payload, copy_len);
	ESP_LOGI(TAG, "ws payload len=%d body=%s", payload_len, json);

	cJSON *root = cJSON_Parse(json);
	if (root == NULL) {
		ESP_LOGE(TAG, "invalid websocket payload");
		return;
	}

	// New protocol: server pushes `{ cursor, message }` envelopes.
	cJSON *cursor = cJSON_GetObjectItem(root, "cursor");
	cJSON *message = cJSON_GetObjectItem(root, "message");
	if (cJSON_IsNumber(cursor) && cJSON_IsObject(message)) {
		process_event_envelope(root);
	} else {
		// Legacy unwrapped messages (defensive fallback).
		process_message(root);
	}

	cJSON_Delete(root);
}

static void heartbeat_task(void *arg) {
	(void)arg;
	while (true) {
		vTaskDelay(pdMS_TO_TICKS(HEARTBEAT_INTERVAL_SECONDS * 1000));

		if (s_render_in_progress) {
			// Render path already owns WS-stop/start; skip this tick.
			continue;
		}

		// Pause the WS so the TLS handshake for our HTTPS calls has enough
		// heap. The mbedtls fragment buffers are also tuned down via sdkconfig
		// to make this less critical, but the belt-and-suspenders approach
		// keeps things robust on the ESP32-C6.
		frame_ws_stop();

		char body[128];
		snprintf(
			body,
			sizeof(body),
			"{\"status\":\"heartbeat\",\"heartbeatEvery\":%u,\"cursor\":%" PRId64 "}",
			(unsigned)HEARTBEAT_INTERVAL_SECONDS,
			s_last_cursor
		);
		if (!frame_api_state(body)) {
			ESP_LOGW(TAG, "heartbeat post failed");
		}
		// Catch up on any events that arrived (or were missed) while the WS
		// was disconnected.
		poll_events_until_idle(0);

		frame_ws_start();
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
	if (s_settings.frame_auth_key[0] == '\0' && FRAME_AUTH_KEY_FALLBACK[0] != '\0') {
		snprintf(
			s_settings.frame_auth_key,
			sizeof(s_settings.frame_auth_key),
			"%s",
			FRAME_AUTH_KEY_FALLBACK
		);
		settings_store_save(&s_settings);
	}
	ESP_ERROR_CHECK(wifi_manager_init() ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(ble_provisioning_start(&s_settings, apply_new_wifi_config) ? ESP_OK : ESP_FAIL);

	if (strlen(s_settings.wifi_ssid) == 0) {
		ESP_LOGW(TAG, "wifi not provisioned yet");
		return;
	}

	if (s_settings.frame_auth_key[0] == '\0') {
		ESP_LOGE(TAG, "no frame auth key configured; refusing to connect");
		return;
	}

	ESP_ERROR_CHECK(wifi_manager_connect(s_settings.wifi_ssid, s_settings.wifi_password) ? ESP_OK : ESP_FAIL);
	while (!wifi_manager_wait_until_ready(WIFI_READY_WAIT_MS)) {
		ESP_LOGW(TAG, "wifi not ready after %ds, still waiting", WIFI_READY_WAIT_MS / 1000);
	}

	// Bearer auth wiring for HTTP + WS clients.
	frame_api_init(FRAME_BASE_URL, s_settings.frame_auth_key);
	frame_fetcher_set_auth_key(s_settings.frame_auth_key);
	display_driver_set_auth_key(s_settings.frame_auth_key);

	// Initial handshake over HTTP. This also produces a display if the frame
	// has none pending and applies any queued commands.
	send_hello_request();

	ESP_ERROR_CHECK(frame_ws_init(WS_BASE_URL, s_settings.frame_auth_key, ws_message_handler, ws_connected_handler) ? ESP_OK : ESP_FAIL);
	ESP_ERROR_CHECK(frame_ws_start() ? ESP_OK : ESP_FAIL);
	ESP_LOGI(TAG, "connected to websocket");

	xTaskCreate(heartbeat_task, "heartbeat_task", 4096, NULL, 5, NULL);
}
