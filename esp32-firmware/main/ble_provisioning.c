#include "ble_provisioning.h"

#include <stdio.h>
#include <stdint.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "host/ble_gap.h"
#include "host/ble_gatt.h"
#include "host/ble_hs_adv.h"
#include "host/ble_hs.h"
#include "host/ble_hs_mbuf.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

static const char *TAG = "ble_provisioning";
static frame_settings_t *s_settings;
static ble_wifi_update_handler_t s_handler;
static uint8_t s_own_addr_type;
static char s_log_buffer[512] = "ready";

static void start_advertising(void);

typedef enum {
	CHR_WIFI_PROVISION = 1,
	CHR_LOG_READ = 2
} ble_char_kind_t;

static void append_log(const char *message) {
	size_t current = strnlen(s_log_buffer, sizeof(s_log_buffer));
	size_t remaining = sizeof(s_log_buffer) - current - 1;
	if (remaining == 0) {
		return;
	}
	int written = snprintf(s_log_buffer + current, remaining + 1, "\n%s", message);
	if (written < 0) {
		return;
	}
}

static bool ble_provisioning_handle_write(const char *json_payload) {
	cJSON *root = cJSON_Parse(json_payload);
	if (root == NULL) {
		append_log("invalid json payload");
		return false;
	}

	cJSON *type = cJSON_GetObjectItem(root, "type");
	cJSON *ssid = cJSON_GetObjectItem(root, "ssid");
	cJSON *password = cJSON_GetObjectItem(root, "password");
	cJSON *device_id = cJSON_GetObjectItem(root, "deviceId");

	if (!cJSON_IsString(type) || strcmp(type->valuestring, "wifiProvision") != 0) {
		cJSON_Delete(root);
		append_log("ignored non wifiProvision payload");
		return false;
	}
	if (cJSON_IsString(ssid)) {
		strncpy(s_settings->wifi_ssid, ssid->valuestring, sizeof(s_settings->wifi_ssid) - 1);
		s_settings->wifi_ssid[sizeof(s_settings->wifi_ssid) - 1] = '\0';
	}
	if (cJSON_IsString(password)) {
		strncpy(
			s_settings->wifi_password, password->valuestring, sizeof(s_settings->wifi_password) - 1);
		s_settings->wifi_password[sizeof(s_settings->wifi_password) - 1] = '\0';
	}
	if (cJSON_IsString(device_id)) {
		strncpy(s_settings->device_id, device_id->valuestring, sizeof(s_settings->device_id) - 1);
		s_settings->device_id[sizeof(s_settings->device_id) - 1] = '\0';
	}

	if (s_handler != NULL) {
		s_handler(s_settings);
	}

	append_log("wifi credentials received over BLE");
	cJSON_Delete(root);
	return true;
}

static int gatt_characteristic_access(
	uint16_t conn_handle,
	uint16_t attr_handle,
	struct ble_gatt_access_ctxt *ctxt,
	void *arg
) {
	(void)conn_handle;
	(void)attr_handle;
	ble_char_kind_t kind = (ble_char_kind_t)(intptr_t)arg;

	if (kind == CHR_WIFI_PROVISION) {
		char payload[320] = {0};
		uint16_t payload_len = OS_MBUF_PKTLEN(ctxt->om);
		if (payload_len >= sizeof(payload)) {
			payload_len = sizeof(payload) - 1;
		}
		int rc = ble_hs_mbuf_to_flat(ctxt->om, payload, payload_len, NULL);
		if (rc != 0) {
			append_log("failed to decode BLE payload");
			return BLE_ATT_ERR_UNLIKELY;
		}
		payload[payload_len] = '\0';
		return ble_provisioning_handle_write(payload) ? 0 : BLE_ATT_ERR_UNLIKELY;
	}

	if (kind == CHR_LOG_READ) {
		return os_mbuf_append(ctxt->om, s_log_buffer, strnlen(s_log_buffer, sizeof(s_log_buffer)));
	}

	return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def gatt_services[] = {
	{
		.type = BLE_GATT_SVC_TYPE_PRIMARY,
		.uuid = BLE_UUID16_DECLARE(0xec00),
		.characteristics =
			(struct ble_gatt_chr_def[]) {
				{
					.uuid = BLE_UUID16_DECLARE(0xec0e),
					.access_cb = gatt_characteristic_access,
					.flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
					.arg = (void *)(intptr_t)CHR_WIFI_PROVISION
				},
				{
					.uuid = BLE_UUID16_DECLARE(0xec0f),
					.access_cb = gatt_characteristic_access,
					.flags = BLE_GATT_CHR_F_READ,
					.arg = (void *)(intptr_t)CHR_LOG_READ
				},
				{0}
			}
	},
	{0}
};

static int gap_event_handler(struct ble_gap_event *event, void *arg) {
	(void)arg;
	if (event->type == BLE_GAP_EVENT_CONNECT) {
		append_log(event->connect.status == 0 ? "BLE client connected" : "BLE connect failed");
		if (event->connect.status != 0) {
			start_advertising();
		}
	}
	if (event->type == BLE_GAP_EVENT_DISCONNECT) {
		append_log("BLE client disconnected");
		start_advertising();
	}
	if (event->type == BLE_GAP_EVENT_ADV_COMPLETE) {
		start_advertising();
	}
	return 0;
}

static void start_advertising(void) {
	struct ble_hs_adv_fields fields = {0};
	static ble_uuid16_t service_uuid = BLE_UUID16_INIT(0xec00);

	fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
	fields.name = (const uint8_t *)"PictureFrame";
	fields.name_len = strlen("PictureFrame");
	fields.name_is_complete = 1;
	fields.uuids16 = &service_uuid;
	fields.num_uuids16 = 1;
	fields.uuids16_is_complete = 1;

	int rc = ble_gap_adv_set_fields(&fields);
	if (rc != 0) {
		ESP_LOGE(TAG, "ble_gap_adv_set_fields failed: %d", rc);
		return;
	}

	struct ble_gap_adv_params adv_params = {0};
	adv_params.conn_mode = BLE_GAP_CONN_MODE_UND;
	adv_params.disc_mode = BLE_GAP_DISC_MODE_GEN;

	rc = ble_gap_adv_start(
		s_own_addr_type,
		NULL,
		BLE_HS_FOREVER,
		&adv_params,
		gap_event_handler,
		NULL
	);
	if (rc != 0) {
		ESP_LOGE(TAG, "ble_gap_adv_start failed: %d", rc);
	}
}

static void ble_on_sync(void) {
	int rc = ble_hs_id_infer_auto(0, &s_own_addr_type);
	if (rc != 0) {
		ESP_LOGE(TAG, "ble_hs_id_infer_auto failed: %d", rc);
		return;
	}
	start_advertising();
}

static void ble_host_task(void *param) {
	(void)param;
	nimble_port_run();
	nimble_port_freertos_deinit();
}

bool ble_provisioning_start(frame_settings_t *settings, ble_wifi_update_handler_t on_update) {
	s_settings = settings;
	s_handler = on_update;

	ESP_ERROR_CHECK(nimble_port_init());
	ble_hs_cfg.sync_cb = ble_on_sync;

	ble_svc_gap_init();
	ble_svc_gatt_init();
	ble_svc_gap_device_name_set("PictureFrame");

	int rc = ble_gatts_count_cfg(gatt_services);
	if (rc != 0) {
		ESP_LOGE(TAG, "ble_gatts_count_cfg failed: %d", rc);
		return false;
	}
	rc = ble_gatts_add_svcs(gatt_services);
	if (rc != 0) {
		ESP_LOGE(TAG, "ble_gatts_add_svcs failed: %d", rc);
		return false;
	}

	nimble_port_freertos_init(ble_host_task);
	ESP_LOGI(TAG, "BLE provisioning active (service ec00)");
	return true;
}
