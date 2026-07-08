#include <string.h>

#include "cJSON.h"
#include "driver/usb_serial_jtag.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "serial_provisioning.h"

static const char *TAG = "serial_prov";

static bool s_running = false;
static serial_wifi_update_handler_t s_handler = NULL;
static frame_settings_t *s_settings = NULL;
static TaskHandle_t s_task_handle = NULL;

#define RX_BUF_SIZE 512

static void serial_provisioning_task(void *arg) {
	(void)arg;
	char rx_buf[RX_BUF_SIZE];
	size_t rx_pos = 0;

	while (s_running) {
		uint8_t raw[64];
		int len = usb_serial_jtag_read_bytes(raw, sizeof(raw), pdMS_TO_TICKS(250));
		if (len <= 0) {
			continue;
		}

		for (int i = 0; i < len; i++) {
			char c = (char)raw[i];
			if (c == '\n' || c == '\r') {
				if (rx_pos > 0) {
					rx_buf[rx_pos] = '\0';
					cJSON *root = cJSON_Parse(rx_buf);
					if (root != NULL) {
						cJSON *type = cJSON_GetObjectItem(root, "type");
						if (cJSON_IsString(type) && type->valuestring != NULL &&
							strcmp(type->valuestring, "wifiProvision") == 0) {

							cJSON *ssid = cJSON_GetObjectItem(root, "ssid");
							cJSON *password = cJSON_GetObjectItem(root, "password");
							cJSON *auth_key = cJSON_GetObjectItem(root, "authKey");

							if (cJSON_IsString(ssid) && ssid->valuestring != NULL) {
								strncpy(s_settings->wifi_ssid, ssid->valuestring,
									sizeof(s_settings->wifi_ssid) - 1);
							}
							if (cJSON_IsString(password) && password->valuestring != NULL) {
								strncpy(s_settings->wifi_password, password->valuestring,
									sizeof(s_settings->wifi_password) - 1);
							}
							if (cJSON_IsString(auth_key) && auth_key->valuestring != NULL) {
								strncpy(s_settings->frame_auth_key, auth_key->valuestring,
									sizeof(s_settings->frame_auth_key) - 1);
							}

							ESP_LOGI(TAG, "received wifi config over serial, ssid=%s",
								s_settings->wifi_ssid);

							const char *ack = "{\"type\":\"wifiProvision\",\"status\":\"ok\"}\n";
							usb_serial_jtag_write_bytes(ack, strlen(ack), portMAX_DELAY);

							if (s_handler != NULL) {
								s_handler(s_settings);
							}
						}
						cJSON_Delete(root);
					}
					rx_pos = 0;
				}
			} else if (rx_pos < RX_BUF_SIZE - 1) {
				rx_buf[rx_pos++] = c;
			}
		}
	}

	vTaskDelete(NULL);
}

bool serial_provisioning_start(frame_settings_t *settings, serial_wifi_update_handler_t on_update) {
	if (s_running) {
		return false;
	}

	s_settings = settings;
	s_handler = on_update;
	s_running = true;

	usb_serial_jtag_driver_config_t usb_serial_jtag_config = {
		.rx_buffer_size = 512,
		.tx_buffer_size = 128,
	};
	usb_serial_jtag_driver_install(&usb_serial_jtag_config);

	BaseType_t ok = xTaskCreate(serial_provisioning_task, "serial_prov", 3072, NULL, 3, &s_task_handle);
	if (ok != pdPASS) {
		ESP_LOGE(TAG, "failed to create serial provisioning task");
		s_running = false;
		return false;
	}

	ESP_LOGI(TAG, "serial provisioning started");
	return true;
}

void serial_provisioning_stop(void) {
	if (!s_running) {
		return;
	}

	s_running = false;

	if (s_task_handle != NULL) {
		vTaskDelete(s_task_handle);
		s_task_handle = NULL;
	}

	usb_serial_jtag_driver_uninstall();

	ESP_LOGI(TAG, "serial provisioning stopped");
}
