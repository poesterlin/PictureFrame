# ESP32 Pilot and Cutover

This runbook replaces the Raspberry Pi runtime with one ESP32-S3 pilot device and then decommissions `update-service` from production use.

## 1) Pilot Device Setup

1. Build and flash firmware from `esp32-firmware/`.
2. Set menuconfig values:
   - WebSocket base URL
   - Frame asset base URL
3. Open `/connect` and provision Wi-Fi credentials and `deviceId`.
4. Confirm device connects to: `wss://<host>/ws?deviceId=<deviceId>`

## 2) Validation Matrix

### Display fidelity

- Upload at least 10 mixed images (people, gradients, text, high-contrast line art).
- Verify expected palette mapping and dimensions (800x480) on panel.
- Confirm `.pf7a` artifacts are generated and retrievable in object storage.

### Connectivity and reliability

- Send settings command with `refreshEvery` and verify heartbeat updates arrive on server state tracking.
- Trigger `refreshNow` and `syncNow` commands and verify immediate fetch/render.
- Disconnect Wi-Fi during update and confirm:
  - no queued frame history is replayed later
  - current frame remains visible
  - next successful update renders normally

### Provisioning UX

- Re-run BLE provisioning from `/connect`.
- Verify new credentials persist across reboot.

## 3) Production Cutover

1. Point production device(s) to ESP32 hardware and unique `deviceId`s.
2. Use only `/ws?deviceId=<deviceId>` channels in operations tooling.
3. Keep `update-service/` available for rollback during first week.
4. Disable Pi host automation jobs (cron/pm2) after pilot acceptance.
5. Keep `update-service/` source as legacy reference until final cleanup PR.

## 4) Rollback Criteria

Rollback to Raspberry Pi runtime only if one of these occurs:

- repeated render corruption on accepted `.pf7a` payloads
- WebSocket reconnect instability under normal Wi-Fi conditions
- BLE provisioning cannot recover a factory-reset device
