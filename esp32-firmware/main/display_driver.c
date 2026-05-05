#include "display_driver.h"

#include <stdlib.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "display_driver";
static const uint8_t HEADER_SIZE = 8;
static const char MAGIC[] = {'P', 'F', '7', 'A'};
static const uint16_t PANEL_WIDTH = 800;
static const uint16_t PANEL_HEIGHT = 480;
static const size_t PANEL_BUFFER_SIZE = (PANEL_WIDTH / 2) * PANEL_HEIGHT;

// XIAO ESP32-S3 wiring documented in esp32-firmware/README.md.
static const gpio_num_t PIN_SCLK = GPIO_NUM_12;
static const gpio_num_t PIN_MOSI = GPIO_NUM_11;
static const gpio_num_t PIN_CS = GPIO_NUM_10;
static const gpio_num_t PIN_DC = GPIO_NUM_9;
static const gpio_num_t PIN_RST = GPIO_NUM_8;
static const gpio_num_t PIN_BUSY = GPIO_NUM_7;

static spi_device_handle_t s_spi;
static bool s_bus_ready;
static uint8_t *s_panel_buffer;
static int s_busy_idle_level = 1;
static bool s_use_timed_busy_fallback = false;

static bool gpio_write(gpio_num_t pin, uint32_t level) {
	return gpio_set_level(pin, (int)level) == ESP_OK;
}

static bool epd_spi_write(const uint8_t *data, size_t len) {
	if (s_spi == NULL || data == NULL || len == 0) {
		return false;
	}
	spi_transaction_t t = {0};
	t.length = len * 8;
	t.tx_buffer = data;
	return spi_device_polling_transmit(s_spi, &t) == ESP_OK;
}

static bool epd_send_command(uint8_t command) {
	if (!gpio_write(PIN_DC, 0) || !gpio_write(PIN_CS, 0)) {
		return false;
	}
	bool ok = epd_spi_write(&command, 1);
	if (!gpio_write(PIN_CS, 1)) {
		return false;
	}
	return ok;
}

static bool epd_send_data_byte(uint8_t value) {
	if (!gpio_write(PIN_DC, 1) || !gpio_write(PIN_CS, 0)) {
		return false;
	}
	bool ok = epd_spi_write(&value, 1);
	if (!gpio_write(PIN_CS, 1)) {
		return false;
	}
	return ok;
}

static bool epd_send_data_buffer(const uint8_t *buffer, size_t len) {
	// Keep command/data write timing and CS strobes close to Waveshare reference driver.
	for (size_t i = 0; i < len; i++) {
		if (!epd_send_data_byte(buffer[i])) {
			return false;
		}
	}
	return true;
}

static bool epd_wait_busy_idle_level(void) {
	if (s_use_timed_busy_fallback) {
		vTaskDelay(pdMS_TO_TICKS(200));
		return true;
	}
	const int max_wait_ms = 30000;
	int waited = 0;
	while (gpio_get_level(PIN_BUSY) != s_busy_idle_level) {
		vTaskDelay(pdMS_TO_TICKS(1));
		waited += 1;
		if (waited >= max_wait_ms) {
			ESP_LOGE(
				TAG,
				"busy wait timed out (idle_level=%d current_level=%d)",
				s_busy_idle_level,
				gpio_get_level(PIN_BUSY)
			);
			return false;
		}
	}
	return true;
}

static bool epd_reset(void) {
	if (!gpio_write(PIN_RST, 1)) {
		return false;
	}
	vTaskDelay(pdMS_TO_TICKS(20));
	if (!gpio_write(PIN_RST, 0)) {
		return false;
	}
	vTaskDelay(pdMS_TO_TICKS(2));
	if (!gpio_write(PIN_RST, 1)) {
		return false;
	}
	vTaskDelay(pdMS_TO_TICKS(20));
	return true;
}

static bool epd_turn_on_display(void) {
	if (!epd_send_command(0x04)) {
		return false;
	}
	if (s_use_timed_busy_fallback) {
		// Panel power-on and refresh can take several seconds; fixed delays are safer when BUSY is unreliable.
		vTaskDelay(pdMS_TO_TICKS(250));
	} else if (!epd_wait_busy_idle_level()) {
		return false;
	}

	if (!epd_send_command(0x12) || !epd_send_data_byte(0x00)) {
		return false;
	}
	if (s_use_timed_busy_fallback) {
		vTaskDelay(pdMS_TO_TICKS(18000));
	} else if (!epd_wait_busy_idle_level()) {
		return false;
	}

	if (!epd_send_command(0x02) || !epd_send_data_byte(0x00)) {
		return false;
	}
	if (s_use_timed_busy_fallback) {
		vTaskDelay(pdMS_TO_TICKS(250));
	} else if (!epd_wait_busy_idle_level()) {
		return false;
	}
	return true;
}

static bool epd_init_sequence_once(void) {
	ESP_LOGI(
		TAG,
		"panel init with busy idle level=%d (busy pin before reset=%d)",
		s_busy_idle_level,
		gpio_get_level(PIN_BUSY)
	);
	if (!epd_reset()) {
		return false;
	}
	ESP_LOGI(TAG, "busy pin after reset=%d", gpio_get_level(PIN_BUSY));
	if (!epd_wait_busy_idle_level()) {
		return false;
	}
	vTaskDelay(pdMS_TO_TICKS(30));

	if (!epd_send_command(0xAA) || !epd_send_data_byte(0x49) || !epd_send_data_byte(0x55) ||
		!epd_send_data_byte(0x20) || !epd_send_data_byte(0x08) || !epd_send_data_byte(0x09) ||
		!epd_send_data_byte(0x18)) {
		return false;
	}
	if (!epd_send_command(0x01) || !epd_send_data_byte(0x3F) || !epd_send_data_byte(0x00) ||
		!epd_send_data_byte(0x32) || !epd_send_data_byte(0x2A) || !epd_send_data_byte(0x0E) ||
		!epd_send_data_byte(0x2A)) {
		return false;
	}
	if (!epd_send_command(0x00) || !epd_send_data_byte(0x5F) || !epd_send_data_byte(0x69)) {
		return false;
	}
	if (!epd_send_command(0x03) || !epd_send_data_byte(0x00) || !epd_send_data_byte(0x54) ||
		!epd_send_data_byte(0x00) || !epd_send_data_byte(0x44)) {
		return false;
	}
	if (!epd_send_command(0x05) || !epd_send_data_byte(0x40) || !epd_send_data_byte(0x1F) ||
		!epd_send_data_byte(0x1F) || !epd_send_data_byte(0x2C)) {
		return false;
	}
	if (!epd_send_command(0x06) || !epd_send_data_byte(0x6F) || !epd_send_data_byte(0x1F) ||
		!epd_send_data_byte(0x16) || !epd_send_data_byte(0x25)) {
		return false;
	}
	if (!epd_send_command(0x08) || !epd_send_data_byte(0x6F) || !epd_send_data_byte(0x1F) ||
		!epd_send_data_byte(0x1F) || !epd_send_data_byte(0x22)) {
		return false;
	}
	if (!epd_send_command(0x13) || !epd_send_data_byte(0x00) || !epd_send_data_byte(0x04)) {
		return false;
	}
	if (!epd_send_command(0x30) || !epd_send_data_byte(0x02)) {
		return false;
	}
	if (!epd_send_command(0x41) || !epd_send_data_byte(0x00)) {
		return false;
	}
	if (!epd_send_command(0x50) || !epd_send_data_byte(0x3F)) {
		return false;
	}
	if (!epd_send_command(0x60) || !epd_send_data_byte(0x02) || !epd_send_data_byte(0x00)) {
		return false;
	}
	if (!epd_send_command(0x61) || !epd_send_data_byte(0x03) || !epd_send_data_byte(0x20) ||
		!epd_send_data_byte(0x01) || !epd_send_data_byte(0xE0)) {
		return false;
	}
	if (!epd_send_command(0x82) || !epd_send_data_byte(0x1E)) {
		return false;
	}
	if (!epd_send_command(0x84) || !epd_send_data_byte(0x00)) {
		return false;
	}
	if (!epd_send_command(0x86) || !epd_send_data_byte(0x00)) {
		return false;
	}
	if (!epd_send_command(0xE3) || !epd_send_data_byte(0x2F)) {
		return false;
	}
	if (!epd_send_command(0xE0) || !epd_send_data_byte(0x00)) {
		return false;
	}
	if (!epd_send_command(0xE6) || !epd_send_data_byte(0x00)) {
		return false;
	}
	return true;
}

static bool epd_init_sequence(void) {
	if (epd_init_sequence_once()) {
		return true;
	}

	// If BUSY line is miswired/stuck, continue with conservative fixed delays.
	s_use_timed_busy_fallback = true;
	s_busy_idle_level = 1;
	ESP_LOGW(TAG, "retrying panel init using timed busy fallback");
	return epd_init_sequence_once();
}

static bool epd_display_packed_buffer(const uint8_t *packed_buffer, uint16_t width, uint16_t height) {
	if (!epd_init_sequence()) {
		ESP_LOGE(TAG, "panel init failed before display");
		return false;
	}
	if (!epd_send_command(0x10)) {
		ESP_LOGE(TAG, "failed to start frame write");
		return false;
	}
	for (uint16_t row = 0; row < height; row++) {
		const uint8_t *row_ptr = packed_buffer + ((size_t)row * (width / 2));
		if (!epd_send_data_buffer(row_ptr, width / 2)) {
			ESP_LOGE(TAG, "failed writing frame row %u", (unsigned)row);
			return false;
		}
	}
	if (!epd_turn_on_display()) {
		ESP_LOGE(TAG, "display refresh failed");
		return false;
	}
	return true;
}

static uint8_t normalize_color(uint8_t value) {
	// Keep compatibility with old GUI_ReadBmp_RGB_7Color behavior.
	return value >= 7 ? 1 : value;
}

bool display_driver_init(void) {
	if (s_bus_ready) {
		return true;
	}

	const gpio_config_t out_cfg = {
		.pin_bit_mask = (1ULL << PIN_CS) | (1ULL << PIN_DC) | (1ULL << PIN_RST),
		.mode = GPIO_MODE_OUTPUT,
		.pull_up_en = GPIO_PULLUP_DISABLE,
		.pull_down_en = GPIO_PULLDOWN_DISABLE,
		.intr_type = GPIO_INTR_DISABLE
	};
	if (gpio_config(&out_cfg) != ESP_OK) {
		ESP_LOGE(TAG, "failed to configure output pins");
		return false;
	}
	const gpio_config_t in_cfg = {
		.pin_bit_mask = (1ULL << PIN_BUSY),
		.mode = GPIO_MODE_INPUT,
		// Some Waveshare-compatible boards expose BUSY as open-drain and require a pull-up.
		.pull_up_en = GPIO_PULLUP_ENABLE,
		.pull_down_en = GPIO_PULLDOWN_DISABLE,
		.intr_type = GPIO_INTR_DISABLE
	};
	if (gpio_config(&in_cfg) != ESP_OK) {
		ESP_LOGE(TAG, "failed to configure busy pin");
		return false;
	}
	if (!gpio_write(PIN_CS, 1) || !gpio_write(PIN_DC, 1) || !gpio_write(PIN_RST, 1)) {
		ESP_LOGE(TAG, "failed to set initial pin state");
		return false;
	}

	spi_bus_config_t bus_cfg = {
		.sclk_io_num = PIN_SCLK,
		.mosi_io_num = PIN_MOSI,
		.miso_io_num = -1,
		.quadwp_io_num = -1,
		.quadhd_io_num = -1,
		.max_transfer_sz = 4096
	};
	if (spi_bus_initialize(SPI2_HOST, &bus_cfg, SPI_DMA_CH_AUTO) != ESP_OK) {
		ESP_LOGE(TAG, "failed to initialize SPI bus");
		return false;
	}
	spi_device_interface_config_t dev_cfg = {
		.mode = 0,
		// Use a conservative SPI clock for wiring/switch-board tolerance during bring-up.
		.clock_speed_hz = 2 * 1000 * 1000,
		.spics_io_num = -1, // software-controlled CS
		.queue_size = 1
	};
	if (spi_bus_add_device(SPI2_HOST, &dev_cfg, &s_spi) != ESP_OK) {
		ESP_LOGE(TAG, "failed to add SPI device");
		return false;
	}

	s_panel_buffer = (uint8_t *)heap_caps_malloc(PANEL_BUFFER_SIZE, MALLOC_CAP_DMA | MALLOC_CAP_8BIT);
	if (s_panel_buffer == NULL) {
		ESP_LOGE(TAG, "failed to allocate DMA-capable panel buffer");
		return false;
	}

	if (!epd_init_sequence()) {
		ESP_LOGE(TAG, "panel init sequence failed");
		return false;
	}

	s_bus_ready = true;
	ESP_LOGI(TAG, "display initialized for Waveshare 7.3in 7-color");
	return true;
}

bool display_driver_render_pf7a(const uint8_t *payload, size_t payload_len) {
	if (!s_bus_ready) {
		ESP_LOGE(TAG, "display not initialized");
		return false;
	}
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

	if (width != PANEL_WIDTH || height != PANEL_HEIGHT) {
		ESP_LOGE(TAG, "unexpected frame dimensions %ux%u", width, height);
		return false;
	}
	if (pixel_count != (size_t)width * (size_t)height) {
		ESP_LOGE(TAG, "invalid frame size");
		return false;
	}

	for (uint16_t y = 0; y < height; y++) {
		size_t src_row = (size_t)y * width;
		size_t dst_row = (size_t)y * (width / 2);
		for (uint16_t x = 0; x < width; x += 2) {
			uint8_t left = normalize_color(pixels[src_row + x]);
			uint8_t right = normalize_color(pixels[src_row + x + 1]);
			s_panel_buffer[dst_row + (x / 2)] = (uint8_t)((left << 4) | right);
		}
	}

	if (!epd_display_packed_buffer(s_panel_buffer, width, height)) {
		return false;
	}

	ESP_LOGI(TAG, "rendered frame %ux%u (%u pixels)", width, height, (unsigned)pixel_count);
	return true;
}

bool display_driver_render_checkerboard(void) {
	if (!s_bus_ready || s_panel_buffer == NULL) {
		ESP_LOGW(TAG, "checkerboard skipped (display not ready)");
		return false;
	}

	const uint16_t tile = 40;
	const uint8_t color_a = 0; // black
	const uint8_t color_b = 1; // white

	for (uint16_t y = 0; y < PANEL_HEIGHT; y++) {
		size_t dst_row = (size_t)y * (PANEL_WIDTH / 2);
		for (uint16_t x = 0; x < PANEL_WIDTH; x += 2) {
			uint8_t left = ((((x / tile) + (y / tile)) & 1) == 0) ? color_a : color_b;
			uint16_t right_x = (uint16_t)(x + 1);
			uint8_t right = ((((right_x / tile) + (y / tile)) & 1) == 0) ? color_a : color_b;
			s_panel_buffer[dst_row + (x / 2)] = (uint8_t)((left << 4) | right);
		}
	}

	if (!epd_display_packed_buffer(s_panel_buffer, PANEL_WIDTH, PANEL_HEIGHT)) {
		return false;
	}
	ESP_LOGI(TAG, "rendered offline checkerboard");
	return true;
}
