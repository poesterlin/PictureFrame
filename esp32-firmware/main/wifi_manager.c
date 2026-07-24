#include "wifi_manager.h"

#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/event_groups.h"

static const char *TAG = "wifi_manager";
static EventGroupHandle_t s_wifi_events;
static const int WIFI_CONNECTED_BIT = BIT0;

// Reconnect strategy: re-associating immediately after every disconnect made
// the AP (observed with a Telekom Speedport in WPA2/WPA3 transition mode)
// ignore the station for a while, visible as AUTH_EXPIRE (reason=2) storms.
// Back off instead and reset the whole wifi stack every few failed attempts.
static const uint32_t RECONNECT_BASE_DELAY_MS = 1000;
static const uint32_t RECONNECT_MAX_DELAY_MS = 15000;
static const uint32_t FAILED_ATTEMPTS_BEFORE_WIFI_RESTART = 5;

static esp_timer_handle_t s_reconnect_timer;
static uint32_t s_consecutive_failures;

static uint32_t reconnect_delay_ms(void) {
	uint32_t delay_ms = RECONNECT_BASE_DELAY_MS;
	for (uint32_t i = 0; i < s_consecutive_failures; ++i) {
		delay_ms *= 2;
		if (delay_ms >= RECONNECT_MAX_DELAY_MS) {
			return RECONNECT_MAX_DELAY_MS;
		}
	}
	return delay_ms;
}

static void schedule_reconnect(void) {
	uint32_t delay_ms = reconnect_delay_ms();
	ESP_LOGI(
		TAG,
		"reconnecting in %ums (failed attempts: %u)",
		(unsigned)delay_ms,
		(unsigned)s_consecutive_failures
	);
	// esp_timer_stop() fails with ESP_ERR_INVALID_STATE when the timer is not
	// running, which is the case on the first call.
	(void)esp_timer_stop(s_reconnect_timer);
	ESP_ERROR_CHECK(esp_timer_start_once(s_reconnect_timer, (uint64_t)delay_ms * 1000));
}

static void reconnect_timer_callback(void *arg) {
	(void)arg;
	if (s_consecutive_failures > 0 && s_consecutive_failures % FAILED_ATTEMPTS_BEFORE_WIFI_RESTART == 0) {
		ESP_LOGW(TAG, "restarting wifi stack after %u failed attempts", (unsigned)s_consecutive_failures);
		// WIFI_EVENT_STA_START fires from esp_wifi_start() and triggers esp_wifi_connect().
		ESP_ERROR_CHECK(esp_wifi_stop());
		ESP_ERROR_CHECK(esp_wifi_start());
		return;
	}
	esp_err_t err = esp_wifi_connect();
	if (err != ESP_OK) {
		ESP_LOGW(TAG, "esp_wifi_connect failed: %s", esp_err_to_name(err));
		schedule_reconnect();
	}
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data) {
	(void)arg;
	if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
		// The frame is mains-powered; keep the radio awake. Modem sleep made
		// the DHCP exchange right after association unreliable.
		ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
		ESP_LOGI(TAG, "wifi sta started, connecting");
		esp_wifi_connect();
	}
	if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
		wifi_event_sta_disconnected_t *disconnected = (wifi_event_sta_disconnected_t *)event_data;
		ESP_LOGW(
			TAG,
			"wifi disconnected (reason=%d)",
			disconnected != NULL ? disconnected->reason : -1
		);
		xEventGroupClearBits(s_wifi_events, WIFI_CONNECTED_BIT);
		s_consecutive_failures++;
		schedule_reconnect();
	}
	if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
		s_consecutive_failures = 0;
		xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
		ip_event_got_ip_t *got_ip = (ip_event_got_ip_t *)event_data;
		ESP_LOGI(TAG, "wifi connected, ip=" IPSTR, IP2STR(&got_ip->ip_info.ip));
	}
}

bool wifi_manager_init(void) {
	s_wifi_events = xEventGroupCreate();
	ESP_ERROR_CHECK(esp_netif_init());
	ESP_ERROR_CHECK(esp_event_loop_create_default());
	esp_netif_create_default_wifi_sta();

	const esp_timer_create_args_t reconnect_timer_args = {
		.callback = &reconnect_timer_callback,
		.name = "wifi_reconnect"
	};
	ESP_ERROR_CHECK(esp_timer_create(&reconnect_timer_args, &s_reconnect_timer));

	wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
	ESP_ERROR_CHECK(esp_wifi_init(&cfg));
	ESP_ERROR_CHECK(
		esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));
	ESP_ERROR_CHECK(
		esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL));
	ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
	return true;
}

bool wifi_manager_connect(const char *ssid, const char *password) {
	wifi_config_t wifi_config = {0};
	strncpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid) - 1);
	strncpy((char *)wifi_config.sta.password, password, sizeof(wifi_config.sta.password) - 1);
	wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;
	// Do not advertise PMF capability: the target AP (WPA2/WPA3 transition
	// mode) answered PMF-capable auth attempts with 4-way handshake timeouts
	// (reason=15) and auth failures (reason=202). The one successful
	// connection negotiated pmf:0 anyway.
	wifi_config.sta.pmf_cfg.capable = false;
	wifi_config.sta.pmf_cfg.required = false;
	ESP_LOGI(
		TAG,
		"wifi connect requested ssid=%s password_len=%u",
		ssid,
		(unsigned)strlen(password)
	);

	ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
	ESP_ERROR_CHECK(esp_wifi_start());
	return true;
}

bool wifi_manager_wait_until_ready(int timeout_ms) {
	TickType_t ticks = pdMS_TO_TICKS(timeout_ms);
	EventBits_t bits = xEventGroupWaitBits(s_wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, ticks);
	return (bits & WIFI_CONNECTED_BIT) != 0;
}
