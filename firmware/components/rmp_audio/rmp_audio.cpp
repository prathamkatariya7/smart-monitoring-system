#include "rmp_audio.h"
#include "rmp_pins.h"
#include <math.h>
#include "driver/i2c.h"
#include "driver/i2s_std.h"
#include "driver/gpio.h"
#include "es8311.h"
#include "esp_log.h"

namespace rmp {

namespace {
constexpr char kTag[] = "rmp_audio";
constexpr i2c_port_t kI2cPort = I2C_NUM_0;
i2s_chan_handle_t s_tx_chan = nullptr;
es8311_handle_t s_codec = nullptr;
bool s_muted = false;

bool i2cBegin() {
  i2c_config_t cfg = {};
  cfg.mode = I2C_MODE_MASTER;
  cfg.sda_io_num = PIN_I2C_SDA;
  cfg.scl_io_num = PIN_I2C_SCL;
  cfg.sda_pullup_en = GPIO_PULLUP_ENABLE;
  cfg.scl_pullup_en = GPIO_PULLUP_ENABLE;
  cfg.master.clk_speed = 400000;
  if (i2c_param_config(kI2cPort, &cfg) != ESP_OK) return false;
  return i2c_driver_install(kI2cPort, I2C_MODE_MASTER, 0, 0, 0) == ESP_OK;
}

bool i2sBegin() {
  i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_AUTO, I2S_ROLE_MASTER);
  if (i2s_new_channel(&chan_cfg, &s_tx_chan, nullptr) != ESP_OK) return false;

  i2s_std_config_t std_cfg = {};
  std_cfg.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(16000);
  // ES8311 codec driver uses standard I2S (Philips format, 1-bit delay).
  // Using PHILIPS slot configuration ensures bit alignment matches the codec.
  std_cfg.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO);
  std_cfg.gpio_cfg.mclk = (gpio_num_t)PIN_I2S_MCLK;
  std_cfg.gpio_cfg.bclk = (gpio_num_t)PIN_I2S_BCLK;
  std_cfg.gpio_cfg.ws = (gpio_num_t)PIN_I2S_WS;
  std_cfg.gpio_cfg.dout = (gpio_num_t)PIN_I2S_DOUT;
  std_cfg.gpio_cfg.din = (gpio_num_t)PIN_I2S_DIN;

  if (i2s_channel_init_std_mode(s_tx_chan, &std_cfg) != ESP_OK) return false;
  return i2s_channel_enable(s_tx_chan) == ESP_OK;
}
}  // namespace

bool Audio::begin() {
  gpio_config_t pa_cfg = {};
  pa_cfg.pin_bit_mask = 1ULL << PIN_PA_CTRL;
  pa_cfg.mode = GPIO_MODE_OUTPUT;
  gpio_config(&pa_cfg);
  gpio_set_level((gpio_num_t)PIN_PA_CTRL, 0);

  if (!i2cBegin()) {
    ESP_LOGW(kTag, "I2C init failed");
    return false;
  }

  s_codec = es8311_create(kI2cPort, ES8311_ADDRESS_0);
  if (s_codec) {
    ESP_LOGI(kTag, "ES8311 found at I2C address 0x18");
  } else {
    s_codec = es8311_create(kI2cPort, ES8311_ADDRESS_1);
    if (s_codec) ESP_LOGI(kTag, "ES8311 found at I2C address 0x19");
  }
  if (!s_codec) {
    ESP_LOGW(kTag, "ES8311 not found on I2C (tried 0x18 and 0x19)");
    return false;
  }

  es8311_clock_config_t clk_cfg = {};
  clk_cfg.mclk_from_mclk_pin = true;
  clk_cfg.mclk_frequency = 16000 * 256;  // MCLK = 256 x fs, matches the Arduino prototype
  clk_cfg.sample_frequency = 16000;
  esp_err_t err = es8311_init(s_codec, &clk_cfg, ES8311_RESOLUTION_16, ES8311_RESOLUTION_16);
  if (err != ESP_OK) {
    ESP_LOGW(kTag, "ES8311 init failed, err=0x%x", err);
    return false;
  }
  ESP_LOGI(kTag, "ES8311 codec initialized");
  es8311_voice_volume_set(s_codec, 100, nullptr);  // max digital volume -- alert tones need to be loud, not musical

  if (!i2sBegin()) {
    ESP_LOGW(kTag, "I2S init failed");
    return false;
  }
  ESP_LOGI(kTag, "I2S channel enabled, audio ready");
  return true;
}

void Audio::setMuted(bool m) {
  s_muted = m;
  if (m) gpio_set_level((gpio_num_t)PIN_PA_CTRL, 0);
  if (s_codec) es8311_voice_mute(s_codec, m);
}

void Audio::beep(uint16_t hz, uint16_t ms) {
  if (s_muted || !s_tx_chan) return;

  // Enable NS4150B amplifier and give it a brief moment to wake from shutdown
  gpio_set_level((gpio_num_t)PIN_PA_CTRL, 1);
  vTaskDelay(pdMS_TO_TICKS(10));

  static float phase = 0;
  int16_t buf[256];
  uint32_t total = 16000UL * ms / 1000, done = 0;
  while (done < total) {
    uint32_t n = total - done < 128 ? total - done : 128;
    for (uint32_t i = 0; i < n; i++) {
      // Full-scale 16-bit sine wave for maximum speaker volume
      int16_t s = (int16_t)(sinf(phase) * 32000.0f);
      buf[2 * i] = buf[2 * i + 1] = s;
      phase += 2.0f * (float)M_PI * hz / 16000.0f;
      if (phase > 2.0f * (float)M_PI) phase -= 2.0f * (float)M_PI;
    }
    size_t written = 0;
    i2s_channel_write(s_tx_chan, buf, n * 4, &written, 1000);
    done += n;
  }

  // Wait for DMA FIFO buffer to finish outputting to codec before shutting down PA
  vTaskDelay(pdMS_TO_TICKS(40));
  gpio_set_level((gpio_num_t)PIN_PA_CTRL, 0);
}

void Audio::beepRaw(uint16_t hz, uint16_t ms) {
  if (!s_tx_chan) return;
  static float phase = 0;
  int16_t buf[256];
  uint32_t total = 16000UL * ms / 1000, done = 0;
  while (done < total) {
    uint32_t n = total - done < 128 ? total - done : 128;
    for (uint32_t i = 0; i < n; i++) {
      int16_t s = (int16_t)(sinf(phase) * 32000.0f);
      buf[2 * i] = buf[2 * i + 1] = s;
      phase += 2.0f * (float)M_PI * hz / 16000.0f;
      if (phase > 2.0f * (float)M_PI) phase -= 2.0f * (float)M_PI;
    }
    size_t written = 0;
    i2s_channel_write(s_tx_chan, buf, n * 4, &written, 1000);
    done += n;
  }
}

}  // namespace rmp
