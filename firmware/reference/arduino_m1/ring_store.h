#pragma once
// Flash ring buffer on the "ring" partition (TDD 7.6).
// Sector = 64 B header + 144 x 28 B records. Physical sector = sseq % N.
// Records are appended write-ahead; the tail only advances on an application-level data-ack (8.2).
#include <Arduino.h>
#include <esp_partition.h>
#include <Preferences.h>
#include "rmp_types.h"
#include "config.h"

class RingStore {
 public:
  static constexpr uint32_t SEC = 4096, HDR = 64, REC = 28, SLOTS = (SEC - HDR) / REC;  // 144
  struct View { SectorHdr hdr; Rec rec[BACKLOG_N]; uint8_t n; };

  bool begin(uint16_t bootId) {
    mtx_ = xSemaphoreCreateRecursiveMutex();
    part_ = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)0x40, "ring");
    if (!part_) return false;
    N_ = part_->size / SEC; boot_ = bootId;
    bool any = false; uint32_t mn = 0xFFFFFFFF, mx = 0; SectorHdr h;
    for (uint32_t p = 0; p < N_; p++)
      if (readHdrPhys(p, h)) { any = true; if (h.sseq < mn) mn = h.sseq; if (h.sseq > mx) mx = h.sseq; }
    nextSseq_ = any ? mx + 1 : 0;
    prefs_.begin("ring", false);
    uint32_t as = prefs_.getUInt("ts", 0xFFFFFFFF), ai = prefs_.getUInt("ti", 0);
    if (!any) { tailS_ = nextSseq_; tailI_ = 0; }
    else if (as == 0xFFFFFFFF || as < mn) { tailS_ = mn; tailI_ = 0; }
    else if (as >= nextSseq_) { tailS_ = nextSseq_; tailI_ = 0; }
    else { tailS_ = as; tailI_ = ai; }
    savedS_ = tailS_; savedI_ = tailI_;
    curS_ = tailS_; curI_ = tailI_;
    memset(&want_, 0, sizeof want_);
    return true;
  }

  // Context for the sector being written. A change that matters starts a new sector.
  void setMeta(uint8_t tsync, int64_t off, const char* attempt, uint16_t cal) {
    lock();
    bool ch = !open_ || tsync != hd_.tsync || cal != hd_.cal ||
              strncmp(attempt, hd_.attempt, sizeof hd_.attempt - 1) != 0 ||
              (tsync == 2 && llabs(off - hd_.utcOffMs) > 250);
    want_.tsync = tsync; want_.utcOffMs = off; want_.cal = cal;
    strlcpy(want_.attempt, attempt, sizeof want_.attempt);
    if (ch) rotate_ = true;
    unlock();
  }
  void forceRotate() { lock(); rotate_ = true; unlock(); }

  bool append(Rec& r) {
    lock();
    if (!open_ || rotate_ || hdIdx_ >= SLOTS) startSector();
    r.boot = boot_; r.crc = crc16(&r, REC - 2);
    bool ok = esp_partition_write(part_, slotOff(hdSseq_, hdIdx_), &r, REC) == ESP_OK;
    hdIdx_++;
    unlock(); return ok;
  }

  // Reads up to maxN records from ONE sector starting at the send cursor. Cursor moves only on commit.
  uint8_t peek(View& v, uint8_t maxN) {
    lock();
    v.n = 0; uint32_t s = curS_, i = curI_, vs = 0; bool have = false;
    while (v.n < maxN) {
      if (s >= nextSseq_) break;
      if (have && s != vs) break;
      uint32_t lim = limitFor(s);
      if (i >= lim) { if ((open_ && s == hdSseq_) || have) break; s++; i = 0; continue; }
      if (!have) { if (!readHdr(s, v.hdr)) { s++; i = 0; continue; } have = true; vs = s; }
      Rec r; uint8_t st = readRec(s, i, r);
      if (st == 2) { i = lim; continue; }          // blank: unused rest of an old sector
      if (st == 1) v.rec[v.n++] = r;
      i++;
    }
    pendS_ = s; pendI_ = i;
    uint8_t n = v.n; unlock(); return n;
  }
  void commitCursor() { lock(); curS_ = pendS_; curI_ = pendI_; unlock(); }
  void rewindCursor() { lock(); curS_ = tailS_; curI_ = tailI_; unlock(); }
  bool outstanding() { return curS_ != tailS_ || curI_ != tailI_; }

  // data-ack from the server: per-boot contiguous high-water mark
  void onAck(uint16_t boot, uint32_t upto) {
    lock();
    int k = -1; for (int j = 0; j < 8; j++) if (ack_[j].used && ack_[j].boot == boot) k = j;
    if (k < 0) { k = ackRr_++ & 7; ack_[k].used = true; ack_[k].boot = boot; ack_[k].upto = 0; }
    if (upto > ack_[k].upto) ack_[k].upto = upto;
    for (;;) {
      if (tailS_ >= nextSseq_) break;
      uint32_t lim = limitFor(tailS_);
      if (tailI_ >= lim) { if (open_ && tailS_ == hdSseq_) break; tailS_++; tailI_ = 0; continue; }
      Rec r; uint8_t st = readRec(tailS_, tailI_, r);
      if (st == 2) { if (open_ && tailS_ == hdSseq_) break; tailS_++; tailI_ = 0; continue; }
      if (st == 0 || isAcked(r.boot, r.seq)) { tailI_++; continue; }
      break;
    }
    if (curS_ < tailS_ || (curS_ == tailS_ && curI_ < tailI_)) { curS_ = tailS_; curI_ = tailI_; }
    unlock();
  }
  void persist() {   // call at most about once a minute (NVS wear)
    lock();
    if (tailS_ != savedS_ || tailI_ != savedI_) {
      prefs_.putUInt("ts", tailS_); prefs_.putUInt("ti", tailI_); savedS_ = tailS_; savedI_ = tailI_;
    }
    unlock();
  }

  uint32_t pendingApprox() {   // records between send cursor and write head
    lock(); uint32_t end = open_ ? hdSseq_ * SLOTS + hdIdx_ : nextSseq_ * SLOTS;
    uint32_t c = curS_ * SLOTS + curI_; unlock(); return end > c ? end - c : 0;
  }
  uint8_t fillPercent() { uint32_t used = nextSseq_ > tailS_ ? nextSseq_ - tailS_ : 0; return (uint8_t)min<uint32_t>(100, used * 100 / N_); }
  uint32_t takeLost() { lock(); uint32_t l = lost_; lost_ = 0; unlock(); return l; }   // records overwritten while unacked
  uint32_t sectors() const { return N_; }

 private:
  struct Ack { bool used = false; uint16_t boot = 0; uint32_t upto = 0; };
  const esp_partition_t* part_ = nullptr; uint32_t N_ = 0; uint16_t boot_ = 0;
  uint32_t nextSseq_ = 0, hdSseq_ = 0, hdIdx_ = 0, tailS_ = 0, tailI_ = 0, curS_ = 0, curI_ = 0;
  uint32_t pendS_ = 0, pendI_ = 0, savedS_ = 0, savedI_ = 0, lost_ = 0;
  bool open_ = false, rotate_ = true; SectorHdr hd_{}, want_{};
  Ack ack_[8]; uint8_t ackRr_ = 0; Preferences prefs_; SemaphoreHandle_t mtx_ = nullptr;

  void lock() { xSemaphoreTakeRecursive(mtx_, portMAX_DELAY); }
  void unlock() { xSemaphoreGiveRecursive(mtx_); }
  size_t slotOff(uint32_t sseq, uint32_t idx) const { return (size_t)(sseq % N_) * SEC + HDR + idx * REC; }
  uint32_t limitFor(uint32_t s) const { return (open_ && s == hdSseq_) ? hdIdx_ : SLOTS; }
  bool isAcked(uint16_t boot, uint32_t seq) const {
    for (int j = 0; j < 8; j++) if (ack_[j].used && ack_[j].boot == boot && seq <= ack_[j].upto) return true;
    return false;
  }
  bool readHdrPhys(uint32_t p, SectorHdr& h) {
    if (esp_partition_read(part_, (size_t)p * SEC, &h, HDR) != ESP_OK) return false;
    return h.magic == 0x524D5031 && h.crc == crc16(&h, HDR - 2) && (h.sseq % N_) == p;
  }
  bool readHdr(uint32_t sseq, SectorHdr& h) { return readHdrPhys(sseq % N_, h) && h.sseq == sseq; }
  uint8_t readRec(uint32_t s, uint32_t i, Rec& r) {   // 0 bad crc, 1 ok, 2 blank
    uint8_t b[REC];
    if (esp_partition_read(part_, slotOff(s, i), b, REC) != ESP_OK) return 0;
    bool blank = true; for (uint32_t k = 0; k < REC; k++) if (b[k] != 0xFF) { blank = false; break; }
    if (blank) return 2;
    memcpy(&r, b, REC);
    return r.crc == crc16(b, REC - 2) ? 1 : 0;
  }
  uint32_t countValid(uint32_t s, uint32_t from) {
    uint32_t n = 0; Rec r;
    for (uint32_t i = from; i < SLOTS; i++) { uint8_t st = readRec(s, i, r); if (st == 2) break; if (st == 1) n++; }
    return n;
  }
  void startSector() {
    uint32_t s = nextSseq_;
    if (s >= N_) {   // the sector we are about to erase held sseq s - N
      uint32_t v = s - N_;
      if (tailS_ <= v) {   // unacked data would be lost: explicit GAP accounting
        lost_ += countValid(v, tailS_ == v ? tailI_ : 0);
        tailS_ = v + 1; tailI_ = 0;
        if (curS_ < tailS_) { curS_ = tailS_; curI_ = 0; }
      }
    }
    esp_partition_erase_range(part_, (size_t)(s % N_) * SEC, SEC);
    SectorHdr h = want_;
    h.magic = 0x524D5031; h.sseq = s; h.boot = boot_; h.rsv = 0; h.crc = crc16(&h, HDR - 2);
    esp_partition_write(part_, (size_t)(s % N_) * SEC, &h, HDR);
    hd_ = h; hdSseq_ = s; hdIdx_ = 0; open_ = true; rotate_ = false; nextSseq_ = s + 1;
    if (tailS_ > s) { tailS_ = s; tailI_ = 0; }
  }
};
