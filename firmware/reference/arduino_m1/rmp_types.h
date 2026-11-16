#pragma once
#include <stdint.h>
#include <stddef.h>

// Sample flag bits (match RMP-TDD-001 8.2)
enum : uint16_t {
  FL_LATE_CYCLE = 1 << 0, FL_TIME_UNSYNCED = 1 << 1, FL_TIME_ESTIMATED = 1 << 2,
  FL_TIME_DERIVED = 1 << 3, FL_GAP = 1 << 4, FL_POST_PLANNED = 1 << 5,
  FL_STARTED_OFFLINE = 1 << 6, FL_LINK_DOWN = 1 << 7
};
enum : uint8_t { Q_GOOD = 0, Q_SUSPECT = 1, Q_BAD = 2 };   // 2 bits per channel: T, RPM, torque

#pragma pack(push, 1)
// 28-byte flash record (7.6)
struct Rec {
  uint32_t seq;      // per boot, contiguous over STORED records
  uint32_t mono_ms;  // uptime at acquisition
  float    t;        // calibrated degC
  float    t_raw;    // uncalibrated degC
  uint16_t rpm;
  int16_t  tq_x10;   // torque in Ncm * 10
  uint8_t  q;        // bits0-1 temp, 2-3 rpm, 4-5 torque
  uint8_t  flt;      // motor fault code
  uint16_t flags;
  uint16_t boot;
  uint16_t crc;
};
// 64-byte sector header: shared context for every record in the sector
struct SectorHdr {
  uint32_t magic;       // 0x524D5031 "RMP1"
  uint32_t sseq;        // monotonically increasing sector sequence
  uint16_t boot;
  uint8_t  tsync;       // 0 unsynced, 1 estimated, 2 NTP synced
  uint8_t  rsv;
  int64_t  utcOffMs;    // utc_ms = mono_ms + utcOffMs (meaningful when tsync >= 1)
  char     attempt[40]; // attempt UUID or "" while idle
  uint16_t cal;
  uint16_t crc;
};
#pragma pack(pop)
static_assert(sizeof(Rec) == 28, "Rec must be 28 bytes");
static_assert(sizeof(SectorHdr) == 64, "SectorHdr must be 64 bytes");

static inline uint16_t crc16(const void* data, size_t n) {   // CRC-16/CCITT-FALSE
  const uint8_t* p = (const uint8_t*)data; uint16_t c = 0xFFFF;
  while (n--) { c ^= (uint16_t)(*p++) << 8; for (int i = 0; i < 8; i++) c = (c & 0x8000) ? (c << 1) ^ 0x1021 : (c << 1); }
  return c;
}
