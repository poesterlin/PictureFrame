#include "frame_fetcher.h"

#include <stdlib.h>
#include <string.h>

#include "esp_http_client.h"
#include "esp_log.h"

static const char *TAG = "frame_fetcher";

typedef struct {
	uint8_t *buffer;
	size_t length;
	size_t capacity;
} fetch_buffer_t;

static esp_err_t http_event_handler(esp_http_client_event_t *evt) {
	fetch_buffer_t *state = (fetch_buffer_t *)evt->user_data;
	if (evt->event_id != HTTP_EVENT_ON_DATA || evt->data_len <= 0) {
		return ESP_OK;
	}

	size_t required = state->length + (size_t)evt->data_len;
	if (required > state->capacity) {
		size_t next_capacity = state->capacity == 0 ? 4096 : state->capacity * 2;
		while (next_capacity < required) {
			next_capacity *= 2;
		}
		uint8_t *next = realloc(state->buffer, next_capacity);
		if (next == NULL) {
			return ESP_FAIL;
		}
		state->buffer = next;
		state->capacity = next_capacity;
	}

	memcpy(state->buffer + state->length, evt->data, (size_t)evt->data_len);
	state->length += (size_t)evt->data_len;
	return ESP_OK;
}

bool frame_fetcher_download(const char *url, frame_payload_t *out_payload) {
	ESP_LOGI(TAG, "downloading frame: %s", url);
	fetch_buffer_t state = {0};
	esp_http_client_config_t config = {
		.url = url,
		.timeout_ms = 15000,
		.transport_type = HTTP_TRANSPORT_OVER_SSL,
		.event_handler = http_event_handler,
		.user_data = &state
	};

	esp_http_client_handle_t client = esp_http_client_init(&config);
	if (client == NULL) {
		return false;
	}

	esp_err_t err = esp_http_client_perform(client);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "download failed: %s", esp_err_to_name(err));
		esp_http_client_cleanup(client);
		free(state.buffer);
		return false;
	}

	int status_code = esp_http_client_get_status_code(client);
	if (status_code < 200 || status_code >= 300) {
		ESP_LOGE(TAG, "download returned HTTP %d", status_code);
		esp_http_client_cleanup(client);
		free(state.buffer);
		return false;
	}
	esp_http_client_cleanup(client);

	out_payload->data = state.buffer;
	out_payload->length = state.length;
	ESP_LOGI(TAG, "downloaded %u bytes", (unsigned)state.length);
	return true;
}

void frame_fetcher_free(frame_payload_t *payload) {
	if (payload->data == NULL) {
		return;
	}
	free(payload->data);
	payload->data = NULL;
	payload->length = 0;
}
