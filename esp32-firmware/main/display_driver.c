#include "display_driver.h"

#include <string.h>

#include "esp_log.h"

static const char *TAG = "display_driver";
static const uint8_t HEADER_SIZE = 8;
static const char MAGIC[] = {'P', 'F', '7', 'A'};

bool display_driver_init(void) {
	ESP_LOGI(TAG, "display init placeholder for Waveshare 7.3in 7-color");
	return true;
}

bool display_driver_render_pf7a(const uint8_t *payload, size_t payload_len) {
	if (payload_len <= HEADER_SIZE) {
		ESP_LOGE(TAG, "frame payload too small");
		return false;
	}
	if (memcmp(payload, MAGIC, sizeof(MAGIC)) != 0) {
		ESP_LOGE(TAG, "invalid frame magic");
		return false;
	}

	uint16_t width = payload[4] | ((uint16_t)payload[5] << 8);
	uint16_t height = payload[6] | ((uint16_t)payload[7] << 8);
	const uint8_t *pixels = payload + HEADER_SIZE;
	size_t pixel_count = payload_len - HEADER_SIZE;

	if (pixel_count != (size_t)width * (size_t)height) {
		ESP_LOGE(TAG, "invalid frame size");
		return false;
	}

	/*
	 * Replace this placeholder with the specific EPD SPI write sequence for the
	 * 7.3in 7-color panel (init -> send pixel indexes -> refresh).
	 */
	ESP_LOGI(TAG, "rendering frame %ux%u (%u pixels)", width, height, (unsigned)pixel_count);
	(void)pixels;
	return true;
}
