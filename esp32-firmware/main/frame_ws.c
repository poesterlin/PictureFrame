#include "frame_ws.h"

#include <stdio.h>
#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"

static const char *TAG = "frame_ws";
static esp_websocket_client_handle_t s_client;
static ws_message_handler_t s_message_handler;
static char s_ws_url[256];

static void ws_event_handler(
	void *handler_args,
	esp_event_base_t base,
	int32_t event_id,
	void *event_data
) {
	(void)handler_args;
	(void)base;

	esp_websocket_event_data_t *data = (esp_websocket_event_data_t *)event_data;
	if (event_id == WEBSOCKET_EVENT_CONNECTED) {
		ESP_LOGI(TAG, "websocket connected: %s", s_ws_url);
		return;
	}

	if (event_id == WEBSOCKET_EVENT_DATA && s_message_handler != NULL) {
		ESP_LOGI(TAG, "websocket rx len=%d op=%d", data->data_len, data->op_code);
		s_message_handler((const char *)data->data_ptr, data->data_len);
		return;
	}

	if (event_id == WEBSOCKET_EVENT_DISCONNECTED) {
		ESP_LOGW(TAG, "websocket disconnected");
		return;
	}

	if (event_id == WEBSOCKET_EVENT_ERROR) {
		ESP_LOGE(TAG, "websocket error");
	}
}

bool frame_ws_init(const char *base_ws_url, const char *device_id, ws_message_handler_t handler) {
	s_message_handler = handler;
	snprintf(s_ws_url, sizeof(s_ws_url), "%s?deviceId=%s", base_ws_url, device_id);

	esp_websocket_client_config_t websocket_cfg = {
		.uri = s_ws_url
	};
	s_client = esp_websocket_client_init(&websocket_cfg);
	if (s_client == NULL) {
		ESP_LOGE(TAG, "failed to create websocket client");
		return false;
	}

	ESP_ERROR_CHECK(esp_websocket_register_events(
		s_client,
		WEBSOCKET_EVENT_ANY,
		ws_event_handler,
		(void *)s_client
	));
	return true;
}

bool frame_ws_start(void) {
	if (s_client == NULL) {
		return false;
	}
	ESP_LOGI(TAG, "starting websocket client");
	return esp_websocket_client_start(s_client) == ESP_OK;
}

bool frame_ws_send(const char *json_payload) {
	if (s_client == NULL || !esp_websocket_client_is_connected(s_client)) {
		ESP_LOGW(TAG, "websocket send dropped (not connected)");
		return false;
	}
	ESP_LOGI(TAG, "websocket tx len=%u", (unsigned)strlen(json_payload));
	return esp_websocket_client_send_text(s_client, json_payload, strlen(json_payload), portMAX_DELAY) >= 0;
}
