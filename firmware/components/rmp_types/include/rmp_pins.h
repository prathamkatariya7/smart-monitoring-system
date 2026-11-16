#pragma once
// Pin map for the Waveshare ESP32-P4-Module-DEV-KIT, taken from the supplied schematic
// (netlist of U2 / P6 / U7 / U8 / J9 / J10 / Q1 / U1). Ported unchanged from the Arduino
// prototype's pins.h (see reference/arduino_m1/pins.h) -- same board, same schematic.
// Header numbers = P6 pin (2x20, odd row 1..39 / even row 2..40).
//
//   P6 odd : 1=5V 3=5V 5=GND 7=TXD(37) 9=RXD(38) 11=22 13=GND 15=5 17=4 19=GND 21=1 23=36 25=32 27=25 29=GND 31=54 33=GND 35=46 37=27 39=45
//   P6 even: 2=3V3 4=SDA(7) 6=SCL(8) 8=23 10=GND 12=21 14=20 16=6 18=3V3 20=3 22=2 24=0 26=GND 28=24 30=33 32=26 34=48 36=53(PA) 38=47 40=GND

// ===================== Reserved by the board - never reuse =====================
#define PIN_CONSOLE_TX   37   // UART0 <- CH343P (Type-C UART, also the flashing port). Strapping pin: keep off.
#define PIN_CONSOLE_RX   38
#define PIN_I2C_SDA       7   // ES8311 control + DSI/CSI connectors + J10 (2.2k pull-ups R57/R60 on board)
#define PIN_I2C_SCL       8
// ES8311 (U8): schematic nets  GPIO9=DSDIN (P4 -> codec)  GPIO10=LRCK  GPIO11=ASDOUT (codec -> P4)  GPIO12=SCLK  GPIO13=MCLK
// NOTE: the Arduino core's stock P4 variant defines I2S_DOUT=11 / I2S_DIN=9 (Function-EV-board wiring). That is the OPPOSITE of this board.
#define PIN_I2S_DOUT      9
#define PIN_I2S_WS       10
#define PIN_I2S_DIN      11
#define PIN_I2S_BCLK     12
#define PIN_I2S_MCLK     13
#define PIN_PA_CTRL      53   // NS4150B CTRL via R52 (0R). Also on header pin 36 - do not drive from outside.
#define PIN_ETH_MDC      31   // IP101GRI (U7)
#define PIN_ETH_MDIO     52
#define PIN_ETH_RST      51   // U7 RESET (active low) - passed to ETH.begin() as the "power" pin
// RMII (fixed by the P4 EMAC, identical in the core's ETH.h): TX_EN 49, TXD0 34, TXD1 35, RXD0 29, RXD1 30, CRS_DV 28, REF_CLK in 50
// Not on the header / not usable: GPIO14-19 (SDIO to the on-module C6), GPIO39-44 (TF slot), GPIO45 (TF power gate Q1; header 39)
// GPIO35 = BOOT key + RMII TXD1, GPIO34-38 are strapping pins, GPIO24/25 = USB D-/D+ (header 28/27), GPIO54 = leave alone (C6-related in ESP-Hosted)
// GPIO32/33 carry 2.2k pull-ups to 3V3 (R49/R50, J9 "I3C") -> used below as active-low button inputs.
// GPIO39-48 sit on the VO4 IO domain. The stock core variant auto-enables the on-chip LDO VO4 when a GPIO in this range is used, and this
// board ties ESP_LDO_VO4 to 3V3 through R80. => Product signals deliberately avoid GPIO39-48.

// ===================== Product signals (all on free header pins) =====================
#define PIN_DWIN_TX      21   // header 12  -> DWIN RXD   (UART1)
#define PIN_DWIN_RX      20   // header 14  <- DWIN TXD
#define PIN_RS232_TX     23   // header  8  -> isolated RS232 transceiver TXD (UART2)
#define PIN_RS232_RX     22   // header 11  <- isolated RS232 transceiver RXD
#define PIN_RTD_SCK       3   // header 20  -> MAX31865 via digital isolator (SPI2)   [3V3 = header 18, GND = header 19 sit right next to it]
#define PIN_RTD_MOSI      2   // header 22
#define PIN_RTD_MISO      6   // header 16
#define PIN_RTD_CS        5   // header 15
#define PIN_RTD_DRDY      4   // header 17  (optional; polling works without it)
#define PIN_BTN_MENU     32   // header 25  active-low, board pull-up R49
#define PIN_BTN_UP       33   // header 30  active-low, board pull-up R50
#define PIN_BTN_DOWN     26   // header 32  active-low, internal pull-up
#define PIN_BTN_SELECT   27   // header 37  active-low, internal pull-up
// spare header GPIOs: 0 (hdr 24), 1 (hdr 21)  [XTAL_32K pads; no crystal fitted on this board]

// ---- compile-time guard: no two signals share a pin, none touches a reserved/VO4/strap pin ----
// This runs at build time regardless of which .cpp includes this header -- see rmp_pins_check.cpp,
// which is compiled unconditionally as part of this component, so the whole project fails to build
// if the pin map is ever broken.
namespace pinguard {
constexpr int used[] = {PIN_DWIN_TX, PIN_DWIN_RX, PIN_RS232_TX, PIN_RS232_RX, PIN_RTD_SCK, PIN_RTD_MOSI, PIN_RTD_MISO,
                        PIN_RTD_CS, PIN_RTD_DRDY, PIN_BTN_MENU, PIN_BTN_UP, PIN_BTN_DOWN, PIN_BTN_SELECT};
constexpr int reserved[] = {7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 24, 25, 28, 29, 30, 31, 34, 35, 36, 37, 38, 49, 50, 51, 52, 53, 54};
constexpr int N = sizeof(used) / sizeof(used[0]);
constexpr int NR = sizeof(reserved) / sizeof(reserved[0]);
constexpr bool ok() {
  for (int i = 0; i < N; i++) {
    if (used[i] >= 39 && used[i] <= 48) return false;                      // VO4 IO domain
    for (int r = 0; r < NR; r++) if (used[i] == reserved[r]) return false; // board-reserved / strapping
    for (int j = i + 1; j < N; j++) if (used[i] == used[j]) return false;  // duplicate
  }
  return true;
}
}  // namespace pinguard
static_assert(pinguard::ok(), "pin collision, reserved pin, or a GPIO39-48 (VO4 domain) pin");
