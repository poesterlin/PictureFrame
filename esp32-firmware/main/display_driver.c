#include "display_driver.h"

#include <stdlib.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "display_driver";
enum { HEADER_SIZE = 8 };
static const char MAGIC_RAW[] = {'P', 'F', '7', 'A'};
static const char MAGIC_RLE[] = {'P', 'F', '7', 'C'};
static const uint16_t PANEL_WIDTH = 800;
static const uint16_t PANEL_HEIGHT = 480;
static const size_t PANEL_BUFFER_SIZE = (PANEL_WIDTH / 2) * PANEL_HEIGHT;

// XIAO ESP32-C6 wiring (silkscreen label -> actual GPIO):
//   RST  D0  -> GPIO0
//   CS   D1  -> GPIO1
//   DC   D3  -> GPIO21
//   BUSY D5  -> GPIO23
//   SCK  D8  -> GPIO19
//   MOSI D10 -> GPIO18
static const gpio_num_t PIN_SCLK = GPIO_NUM_19;
static const gpio_num_t PIN_MOSI = GPIO_NUM_18;
static const gpio_num_t PIN_CS = GPIO_NUM_1;
static const gpio_num_t PIN_DC = GPIO_NUM_21;
static const gpio_num_t PIN_RST = GPIO_NUM_0;
static const gpio_num_t PIN_BUSY = GPIO_NUM_23;

static spi_device_handle_t s_spi;
static bool s_bus_ready;
static uint8_t *s_panel_buffer;
static int s_busy_idle_level = 1;
static bool s_use_timed_busy_fallback = false;

static bool epd_wait_busy_idle_level(void);

typedef struct {
	uint8_t header[HEADER_SIZE];
	size_t bytes_seen;
	size_t pixels_written;
	uint16_t width;
	uint16_t height;
	bool compressed;
	bool rle_ctrl_active;
	bool rle_repeat_mode;
	bool rle_need_value;
	size_t rle_remaining;
	bool header_ok;
	bool failed;
} pf7a_stream_t;

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
	if (buffer == NULL || len == 0) {
		return false;
	}
	if (!gpio_write(PIN_DC, 1) || !gpio_write(PIN_CS, 0)) {
		return false;
	}
	const size_t chunk_size = 512;
	for (size_t offset = 0; offset < len; offset += chunk_size) {
		size_t chunk_len = len - offset;
		if (chunk_len > chunk_size) {
			chunk_len = chunk_size;
		}
		if (!epd_spi_write(buffer + offset, chunk_len)) {
			gpio_write(PIN_CS, 1);
			return false;
		}
	}
	if (!gpio_write(PIN_CS, 1)) {
		return false;
	}
	return true;
}

// Diagnostic: sample BUSY at fixed offsets so we can tell a dead/floating line
// apart from a slow-asserting one without needing a scope.
static void epd_log_busy_samples(const char *phase) {
	const int offsets_us[] = {0, 1000, 5000, 20000, 100000, 500000, 2000000, 5000000};
	const size_t n = sizeof(offsets_us) / sizeof(offsets_us[0]);
	int64_t t0 = esp_timer_get_time();
	int samples[8];
	for (size_t i = 0; i < n; i++) {
		while ((esp_timer_get_time() - t0) < offsets_us[i]) {
			// busy-spin for short offsets to avoid 10ms tick granularity
			if (offsets_us[i] - (int)(esp_timer_get_time() - t0) > 5000) {
				vTaskDelay(1);
			}
		}
		samples[i] = gpio_get_level(PIN_BUSY);
	}
	ESP_LOGI(
		TAG,
		"%s busy samples (us:lvl): 0:%d 1k:%d 5k:%d 20k:%d 100k:%d 500k:%d 2M:%d 5M:%d",
		phase,
		samples[0], samples[1], samples[2], samples[3],
		samples[4], samples[5], samples[6], samples[7]
	);
}

static bool epd_wait_busy_with_probe(uint32_t fallback_ms, const char *phase) {
	if (s_use_timed_busy_fallback) {
		vTaskDelay(pdMS_TO_TICKS(fallback_ms));
		return true;
	}

	const int64_t probe_deadline_us = esp_timer_get_time() + (500 * 1000LL);
	bool saw_busy = false;
	while (esp_timer_get_time() < probe_deadline_us) {
		if (gpio_get_level(PIN_BUSY) != s_busy_idle_level) {
			saw_busy = true;
			break;
		}
		vTaskDelay(1);
	}

	if (!saw_busy) {
		ESP_LOGW(TAG, "%s: BUSY never asserted, switching to timed fallback", phase);
		s_use_timed_busy_fallback = true;
		vTaskDelay(pdMS_TO_TICKS(fallback_ms));
		return true;
	}

	return epd_wait_busy_idle_level();
}

static bool epd_wait_busy_idle_level(void) {
	if (s_use_timed_busy_fallback) {
		vTaskDelay(pdMS_TO_TICKS(200));
		return true;
	}
	const int64_t deadline_us = esp_timer_get_time() + (30 * 1000 * 1000LL);
	while (gpio_get_level(PIN_BUSY) != s_busy_idle_level) {
		vTaskDelay(1);
		if (esp_timer_get_time() >= deadline_us) {
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
	vTaskDelay(pdMS_TO_TICKS(10));
	if (!gpio_write(PIN_RST, 1)) {
		return false;
	}
	vTaskDelay(pdMS_TO_TICKS(20));
	return true;
}

static bool epd_turn_on_display(void) {
	ESP_LOGI(TAG, "POWER_ON command (busy=%d)", gpio_get_level(PIN_BUSY));
	if (!epd_send_command(0x04)) {
		return false;
	}
	epd_log_busy_samples("POWER_ON");
	if (!epd_wait_busy_with_probe(250, "POWER_ON")) {
		return false;
	}
	ESP_LOGI(TAG, "POWER_ON complete (busy=%d)", gpio_get_level(PIN_BUSY));

	ESP_LOGI(TAG, "DISPLAY_REFRESH command (busy=%d)", gpio_get_level(PIN_BUSY));
	if (!epd_send_command(0x12) || !epd_send_data_byte(0x00)) {
		return false;
	}
	epd_log_busy_samples("DISPLAY_REFRESH");
	if (!epd_wait_busy_with_probe(18000, "DISPLAY_REFRESH")) {
		return false;
	}
	ESP_LOGI(TAG, "DISPLAY_REFRESH complete (busy=%d)", gpio_get_level(PIN_BUSY));

	ESP_LOGI(TAG, "POWER_OFF command (busy=%d)", gpio_get_level(PIN_BUSY));
	if (!epd_send_command(0x02) || !epd_send_data_byte(0x00)) {
		return false;
	}
	if (!epd_wait_busy_with_probe(250, "POWER_OFF")) {
		return false;
	}
	ESP_LOGI(TAG, "POWER_OFF complete (busy=%d)", gpio_get_level(PIN_BUSY));
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
		if ((row % 8) == 0) {
			vTaskDelay(1);
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

static bool pf7a_stream_write_pixel(pf7a_stream_t *state, size_t pixel_index, uint8_t value) {
	if (pixel_index >= (size_t)PANEL_WIDTH * PANEL_HEIGHT) {
		return false;
	}
	uint8_t color = normalize_color(value);
	uint8_t *packed = &s_panel_buffer[pixel_index / 2];
	if ((pixel_index & 1) == 0) {
		*packed = (uint8_t)((color << 4) | (*packed & 0x0F));
	} else {
		*packed = (uint8_t)((*packed & 0xF0) | color);
	}
	return true;
}

static bool pf7a_stream_emit_pixel(pf7a_stream_t *state, uint8_t value) {
	if (!pf7a_stream_write_pixel(state, state->pixels_written, value)) {
		return false;
	}
	state->pixels_written++;
	return true;
}

static bool pf7a_stream_consume_rle_byte(pf7a_stream_t *state, uint8_t byte) {
	if (!state->rle_ctrl_active) {
		state->rle_ctrl_active = true;
		state->rle_repeat_mode = byte >= 128;
		state->rle_need_value = state->rle_repeat_mode;
		state->rle_remaining = state->rle_repeat_mode ? (size_t)(byte - 127) : (size_t)(byte + 1);
		if (state->rle_remaining == 0) {
			return false;
		}
		return true;
	}

	if (state->rle_repeat_mode) {
		if (state->rle_need_value) {
			state->rle_need_value = false;
			for (size_t i = 0; i < state->rle_remaining; i++) {
				if (!pf7a_stream_emit_pixel(state, byte)) {
					return false;
				}
			}
			state->rle_ctrl_active = false;
			state->rle_remaining = 0;
			return true;
		}
		return false;
	}

	if (!pf7a_stream_emit_pixel(state, byte)) {
		return false;
	}
	state->rle_remaining--;
	if (state->rle_remaining == 0) {
		state->rle_ctrl_active = false;
	}
	return true;
}

static bool pf7a_stream_parse_header(pf7a_stream_t *state) {
	bool is_raw = memcmp(state->header, MAGIC_RAW, sizeof(MAGIC_RAW)) == 0;
	bool is_rle = memcmp(state->header, MAGIC_RLE, sizeof(MAGIC_RLE)) == 0;
	if (!is_raw && !is_rle) {
		ESP_LOGE(TAG, "invalid frame magic");
		return false;
	}
	state->compressed = is_rle;
	state->width = state->header[4] | ((uint16_t)state->header[5] << 8);
	state->height = state->header[6] | ((uint16_t)state->header[7] << 8);
	if (state->width != PANEL_WIDTH || state->height != PANEL_HEIGHT) {
		ESP_LOGE(TAG, "unexpected frame dimensions %ux%u", state->width, state->height);
		return false;
	}
	state->header_ok = true;
	memset(s_panel_buffer, 0, PANEL_BUFFER_SIZE);
	return true;
}

static esp_err_t pf7a_http_event_handler(esp_http_client_event_t *evt) {
	pf7a_stream_t *state = (pf7a_stream_t *)evt->user_data;
	if (evt->event_id != HTTP_EVENT_ON_DATA || evt->data_len <= 0 || state->failed) {
		return ESP_OK;
	}

	const uint8_t *data = (const uint8_t *)evt->data;
	for (int i = 0; i < evt->data_len; i++) {
		if (state->bytes_seen < HEADER_SIZE) {
			state->header[state->bytes_seen++] = data[i];
			if (state->bytes_seen == HEADER_SIZE && !pf7a_stream_parse_header(state)) {
				state->failed = true;
				return ESP_FAIL;
			}
			continue;
		}
		state->bytes_seen++;

		if (!state->header_ok) {
			state->failed = true;
			return ESP_FAIL;
		}
		if (!state->compressed && !pf7a_stream_emit_pixel(state, data[i])) {
			state->failed = true;
			return ESP_FAIL;
		}
		if (state->compressed && !pf7a_stream_consume_rle_byte(state, data[i])) {
			state->failed = true;
			return ESP_FAIL;
		}
	}
	return ESP_OK;
}

bool display_driver_init(void) {
	if (s_bus_ready) {
		return true;
	}
	ESP_LOGI(
		TAG,
		"pin map sclk=%d mosi=%d cs=%d dc=%d rst=%d busy=%d",
		PIN_SCLK,
		PIN_MOSI,
		PIN_CS,
		PIN_DC,
		PIN_RST,
		PIN_BUSY
	);

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
		// Conservative SPI clock for software-CS over jumper wires; raise once pixels appear.
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
	bool is_raw = memcmp(payload, MAGIC_RAW, sizeof(MAGIC_RAW)) == 0;
	bool is_rle = memcmp(payload, MAGIC_RLE, sizeof(MAGIC_RLE)) == 0;
	if (!is_raw && !is_rle) {
		ESP_LOGE(TAG, "invalid frame magic");
		return false;
	}

	uint16_t width = payload[4] | ((uint16_t)payload[5] << 8);
	uint16_t height = payload[6] | ((uint16_t)payload[7] << 8);
	const uint8_t *pixels = payload + HEADER_SIZE;
	size_t encoded_len = payload_len - HEADER_SIZE;

	if (width != PANEL_WIDTH || height != PANEL_HEIGHT) {
		ESP_LOGE(TAG, "unexpected frame dimensions %ux%u", width, height);
		return false;
	}
	const size_t pixel_count = (size_t)width * (size_t)height;
	if (is_raw) {
		if (encoded_len != pixel_count) {
			ESP_LOGE(TAG, "invalid raw frame size");
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
	} else {
		memset(s_panel_buffer, 0, PANEL_BUFFER_SIZE);
		size_t written = 0;
		size_t i = 0;
		while (i < encoded_len) {
			uint8_t control = pixels[i++];
			size_t run = control >= 128 ? (size_t)(control - 127) : (size_t)(control + 1);
			if (control >= 128) {
				if (i >= encoded_len) {
					ESP_LOGE(TAG, "truncated RLE frame");
					return false;
				}
				uint8_t value = pixels[i++];
				for (size_t j = 0; j < run; j++) {
					if (written >= pixel_count) {
						ESP_LOGE(TAG, "RLE frame overflow");
						return false;
					}
					uint8_t color = normalize_color(value);
					uint8_t *packed = &s_panel_buffer[written / 2];
					if ((written & 1) == 0) {
						*packed = (uint8_t)((color << 4) | (*packed & 0x0F));
					} else {
						*packed = (uint8_t)((*packed & 0xF0) | color);
					}
					written++;
				}
			} else {
				if (i + run > encoded_len) {
					ESP_LOGE(TAG, "truncated RLE literal frame");
					return false;
				}
				for (size_t j = 0; j < run; j++) {
					if (written >= pixel_count) {
						ESP_LOGE(TAG, "RLE frame overflow");
						return false;
					}
					uint8_t color = normalize_color(pixels[i + j]);
					uint8_t *packed = &s_panel_buffer[written / 2];
					if ((written & 1) == 0) {
						*packed = (uint8_t)((color << 4) | (*packed & 0x0F));
					} else {
						*packed = (uint8_t)((*packed & 0xF0) | color);
					}
					written++;
				}
				i += run;
			}
		}
		if (written != pixel_count) {
			ESP_LOGE(TAG, "invalid RLE frame size");
			return false;
		}
	}

	if (!epd_display_packed_buffer(s_panel_buffer, width, height)) {
		return false;
	}

	ESP_LOGI(TAG, "rendered frame %ux%u (%u pixels)", width, height, (unsigned)pixel_count);
	return true;
}

bool display_driver_render_pf7a_url(const char *url) {
	if (!s_bus_ready || s_panel_buffer == NULL) {
		ESP_LOGE(TAG, "display not initialized");
		return false;
	}

	ESP_LOGI(TAG, "streaming frame: %s", url);
	pf7a_stream_t state = {0};
	esp_http_client_config_t config = {
		.url = url,
		.timeout_ms = 20000,
		.transport_type = HTTP_TRANSPORT_OVER_SSL,
		.event_handler = pf7a_http_event_handler,
		.user_data = &state,
		.crt_bundle_attach = esp_crt_bundle_attach
	};

	esp_http_client_handle_t client = esp_http_client_init(&config);
	if (client == NULL) {
		return false;
	}

	esp_err_t err = esp_http_client_perform(client);
	int status_code = esp_http_client_get_status_code(client);
	esp_http_client_cleanup(client);

	if (err != ESP_OK) {
		ESP_LOGE(TAG, "stream download failed: %s", esp_err_to_name(err));
		return false;
	}
	if (status_code < 200 || status_code >= 300) {
		ESP_LOGE(TAG, "stream download returned HTTP %d", status_code);
		return false;
	}
	if (state.failed || state.pixels_written != (size_t)PANEL_WIDTH * PANEL_HEIGHT) {
		ESP_LOGE(TAG, "invalid streamed frame pixels: %u", (unsigned)state.pixels_written);
		return false;
	}
	if (state.compressed && state.rle_ctrl_active) {
		ESP_LOGE(TAG, "truncated streamed RLE frame");
		return false;
	}

	if (!epd_display_packed_buffer(s_panel_buffer, PANEL_WIDTH, PANEL_HEIGHT)) {
		return false;
	}
	ESP_LOGI(TAG, "rendered streamed frame %ux%u", PANEL_WIDTH, PANEL_HEIGHT);
	return true;
}

bool display_driver_render_packed_7color(const uint8_t *packed_buffer, size_t packed_len) {
	if (!s_bus_ready) {
		ESP_LOGE(TAG, "display not initialized");
		return false;
	}
	if (packed_buffer == NULL || packed_len != PANEL_BUFFER_SIZE) {
		ESP_LOGE(TAG, "invalid packed buffer size: %u", (unsigned)packed_len);
		return false;
	}
	if (!epd_display_packed_buffer(packed_buffer, PANEL_WIDTH, PANEL_HEIGHT)) {
		return false;
	}
	ESP_LOGI(TAG, "rendered known packed frame (%u bytes)", (unsigned)packed_len);
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

bool display_driver_render_solid_test(uint8_t color) {
	if (!s_bus_ready || s_panel_buffer == NULL) {
		ESP_LOGW(TAG, "solid test skipped (display not ready)");
		return false;
	}
	uint8_t packed = (uint8_t)((normalize_color(color) << 4) | normalize_color(color));
	memset(s_panel_buffer, packed, PANEL_BUFFER_SIZE);
	if (!epd_display_packed_buffer(s_panel_buffer, PANEL_WIDTH, PANEL_HEIGHT)) {
		return false;
	}
	ESP_LOGI(TAG, "rendered solid test color=%u", color);
	return true;
}
