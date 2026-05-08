#include "frame_api.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"

static const char *TAG = "frame_api";

static char s_base_url[160];
static char s_auth_header[128];

typedef struct {
	char *buffer;
	size_t length;
	size_t capacity;
} response_buffer_t;

static esp_err_t response_event_handler(esp_http_client_event_t *evt) {
	response_buffer_t *state = (response_buffer_t *)evt->user_data;
	if (state == NULL) {
		return ESP_OK;
	}
	if (evt->event_id != HTTP_EVENT_ON_DATA || evt->data_len <= 0) {
		return ESP_OK;
	}

	size_t required = state->length + (size_t)evt->data_len + 1;
	if (required > state->capacity) {
		size_t next_capacity = state->capacity == 0 ? 512 : state->capacity * 2;
		while (next_capacity < required) {
			next_capacity *= 2;
		}
		char *next = realloc(state->buffer, next_capacity);
		if (next == NULL) {
			return ESP_FAIL;
		}
		state->buffer = next;
		state->capacity = next_capacity;
	}

	memcpy(state->buffer + state->length, evt->data, (size_t)evt->data_len);
	state->length += (size_t)evt->data_len;
	state->buffer[state->length] = '\0';
	return ESP_OK;
}

bool frame_api_init(const char *base_url, const char *auth_key) {
	if (base_url == NULL || auth_key == NULL) {
		return false;
	}
	snprintf(s_base_url, sizeof(s_base_url), "%s", base_url);
	// Strip a trailing slash so we can safely append paths beginning with '/'.
	size_t len = strlen(s_base_url);
	if (len > 0 && s_base_url[len - 1] == '/') {
		s_base_url[len - 1] = '\0';
	}
	snprintf(s_auth_header, sizeof(s_auth_header), "Bearer %s", auth_key);
	return true;
}

static bool perform_request(
	esp_http_client_method_t method,
	const char *path,
	const char *body,
	uint32_t timeout_ms,
	response_buffer_t *response
) {
	if (s_base_url[0] == '\0') {
		ESP_LOGE(TAG, "frame_api not initialized");
		return false;
	}

	char url[320];
	snprintf(url, sizeof(url), "%s%s", s_base_url, path);

	esp_http_client_config_t config = {
		.url = url,
		.method = method,
		.timeout_ms = timeout_ms,
		.crt_bundle_attach = esp_crt_bundle_attach,
		.event_handler = response_event_handler,
		.user_data = response
	};

	esp_http_client_handle_t client = esp_http_client_init(&config);
	if (client == NULL) {
		ESP_LOGE(TAG, "failed to init http client");
		return false;
	}

	esp_http_client_set_header(client, "Authorization", s_auth_header);
	if (body != NULL) {
		esp_http_client_set_header(client, "Content-Type", "application/json");
		esp_http_client_set_post_field(client, body, (int)strlen(body));
	}

	esp_err_t err = esp_http_client_perform(client);
	bool ok = false;
	if (err == ESP_OK) {
		int status = esp_http_client_get_status_code(client);
		if (status >= 200 && status < 300) {
			ok = true;
		} else {
			ESP_LOGW(TAG, "%s %s returned HTTP %d", path, body ? "POST" : "GET", status);
		}
	} else {
		ESP_LOGW(TAG, "request to %s failed: %s", path, esp_err_to_name(err));
	}

	esp_http_client_cleanup(client);
	return ok;
}

static char *finalize_response(response_buffer_t *response, bool ok) {
	if (!ok) {
		free(response->buffer);
		return NULL;
	}
	if (response->buffer == NULL) {
		// Successful but empty body; return an empty string so callers can
		// distinguish from failure.
		char *empty = (char *)calloc(1, 1);
		return empty;
	}
	return response->buffer;
}

char *frame_api_hello(const char *json_body) {
	response_buffer_t response = {0};
	bool ok = perform_request(HTTP_METHOD_POST, "/api/frame/hello", json_body, 15000, &response);
	return finalize_response(&response, ok);
}

char *frame_api_snapshot(void) {
	response_buffer_t response = {0};
	bool ok = perform_request(HTTP_METHOD_GET, "/api/frame/snapshot", NULL, 10000, &response);
	return finalize_response(&response, ok);
}

char *frame_api_events(int64_t after, uint32_t wait_ms) {
	response_buffer_t response = {0};
	char path[96];
	snprintf(
		path,
		sizeof(path),
		"/api/frame/events?after=%" PRId64 "&wait=%u",
		after,
		(unsigned)wait_ms
	);
	uint32_t timeout = wait_ms + 5000;
	if (timeout < 10000) {
		timeout = 10000;
	}
	bool ok = perform_request(HTTP_METHOD_GET, path, NULL, timeout, &response);
	return finalize_response(&response, ok);
}

bool frame_api_ack(int64_t cursor) {
	char body[48];
	snprintf(body, sizeof(body), "{\"cursor\":%" PRId64 "}", cursor);
	response_buffer_t response = {0};
	bool ok = perform_request(HTTP_METHOD_POST, "/api/frame/ack", body, 5000, &response);
	free(response.buffer);
	return ok;
}

bool frame_api_state(const char *json_body) {
	response_buffer_t response = {0};
	bool ok = perform_request(HTTP_METHOD_POST, "/api/frame/state", json_body, 5000, &response);
	free(response.buffer);
	return ok;
}
