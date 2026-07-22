#include "frame_ws.h"

#include <stdio.h>
#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_crt_bundle.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"

static const char *TAG = "frame_ws";
static esp_websocket_client_handle_t s_client;
static ws_message_handler_t s_message_handler;
static ws_connected_handler_t s_connected_handler;
static char s_ws_url[320];
static char s_ws_headers[256];

#ifdef CONFIG_IDF_TARGET_ESP32S3
static const int WS_TASK_STACK_SIZE = 16384;
#else
static const int WS_TASK_STACK_SIZE = 4096;
#endif

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
		if (s_connected_handler != NULL) {
			s_connected_handler();
		}
		return;
	}

	if (event_id == WEBSOCKET_EVENT_DATA && s_message_handler != NULL) {
		if (data->op_code != 1 && data->op_code != 2) {
			ESP_LOGD(TAG, "websocket control frame op=%d len=%d", data->op_code, data->data_len);
			return;
		}
		if (data->data_len <= 0 || data->data_ptr == NULL) {
			ESP_LOGD(TAG, "websocket empty data frame op=%d", data->op_code);
			return;
		}
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

bool frame_ws_init(
	const char *base_ws_url,
	const char *auth_key,
	ws_message_handler_t handler,
	ws_connected_handler_t connected_handler
) {
	s_message_handler = handler;
	s_connected_handler = connected_handler;

	// Bearer auth: prefer Authorization header on the upgrade request; also
	// append ?token=<auth_key> as a fallback for transports that strip the
	// header. The server accepts either.
	if (auth_key != NULL && auth_key[0] != '\0') {
		const char *separator = (strchr(base_ws_url, '?') != NULL) ? "&" : "?";
		snprintf(
			s_ws_url,
			sizeof(s_ws_url),
			"%s%stoken=%s",
			base_ws_url,
			separator,
			auth_key
		);
		snprintf(
			s_ws_headers,
			sizeof(s_ws_headers),
			"Authorization: Bearer %s\r\n",
			auth_key
		);
	} else {
		snprintf(s_ws_url, sizeof(s_ws_url), "%s", base_ws_url);
		s_ws_headers[0] = '\0';
	}

	esp_websocket_client_config_t websocket_cfg = {
		.uri = s_ws_url,
		.crt_bundle_attach = esp_crt_bundle_attach,
		.headers = (s_ws_headers[0] != '\0') ? s_ws_headers : NULL,
		.reconnect_timeout_ms = 20000,
		.network_timeout_ms = 20000,
		// Xtensa TLS certificate processing overflows the client's 4 KiB default.
		.task_stack = WS_TASK_STACK_SIZE
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

bool frame_ws_stop(void) {
	if (s_client == NULL) {
		return false;
	}
	ESP_LOGI(TAG, "stopping websocket client");
	return esp_websocket_client_stop(s_client) == ESP_OK;
}
