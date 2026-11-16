#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "esp_partition.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "rmp_types.h"
#include "rmp_config.h"

namespace rmp {

class RingStore {
 public:
  static constexpr uint32_t SEC = 4096;
  static constexpr uint32_t HDR = 64;
  static constexpr uint32_t REC = 28;
  static constexpr uint32_t SLOTS = (SEC - HDR) / REC;  // 144 records per sector
  static constexpr uint8_t  MAX_VIEW_BATCH = BACKLOG_N; // up to 50

  struct View {
    SectorHdr hdr;
    Rec rec[BACKLOG_N];
    uint8_t n;
  };

  RingStore();
  ~RingStore();

  bool begin(uint16_t bootId);

  // Set metadata context for currently open sector
  void setMeta(uint8_t tsync, int64_t off, const char* attempt, uint16_t cal);
  void forceRotate();

  // Write-ahead append a record
  bool append(Rec& r);

  // Peek records from ONE sector for sending
  uint8_t peek(View& v, uint8_t maxN);
  void commitCursor();
  void rewindCursor();
  bool outstanding();

  // Server ACK high-water mark callback
  void onAck(uint16_t boot, uint32_t upto);

  // Periodically persist ring tail to NVS (avoids excessive flash wear)
  void persist();

  uint32_t pendingApprox();
  uint8_t fillPercent();
  uint32_t takeLost();
  uint32_t sectors() const { return N_; }

 private:
  struct Ack {
    bool used = false;
    uint16_t boot = 0;
    uint32_t upto = 0;
  };

  const esp_partition_t* part_ = nullptr;
  uint32_t N_ = 0;
  uint16_t boot_ = 0;
  uint32_t nextSseq_ = 0;
  uint32_t hdSseq_ = 0;
  uint32_t hdIdx_ = 0;
  uint32_t tailS_ = 0;
  uint32_t tailI_ = 0;
  uint32_t curS_ = 0;
  uint32_t curI_ = 0;
  uint32_t pendS_ = 0;
  uint32_t pendI_ = 0;
  uint32_t savedS_ = 0;
  uint32_t savedI_ = 0;
  uint32_t lost_ = 0;
  bool open_ = false;
  bool rotate_ = true;

  SectorHdr hd_{};
  SectorHdr want_{};
  Ack ack_[8];
  uint8_t ackRr_ = 0;
  SemaphoreHandle_t mtx_ = nullptr;

  void lock();
  void unlock();
  size_t slotOff(uint32_t sseq, uint32_t idx) const { return (size_t)(sseq % N_) * SEC + HDR + idx * REC; }
  uint32_t limitFor(uint32_t s) const { return (open_ && s == hdSseq_) ? hdIdx_ : SLOTS; }
  bool isAcked(uint16_t boot, uint32_t seq) const;
  bool readHdrPhys(uint32_t p, SectorHdr& h);
  bool readHdr(uint32_t sseq, SectorHdr& h);
  uint8_t readRec(uint32_t s, uint32_t i, Rec& r);
  uint32_t countValid(uint32_t s, uint32_t from);
  void startSector();
};

}  // namespace rmp

