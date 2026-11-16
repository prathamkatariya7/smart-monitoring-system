#include "rmp_ring.h"
#include <string.h>
#include <stdlib.h>
#include "esp_log.h"
#include "nvs_flash.h"
#include "nvs.h"

namespace rmp {

static const char* TAG = "rmp_ring";

RingStore::RingStore() = default;

RingStore::~RingStore() {
  if (mtx_) {
    vSemaphoreDelete(mtx_);
    mtx_ = nullptr;
  }
}

void RingStore::lock() {
  if (mtx_) {
    xSemaphoreTakeRecursive(mtx_, portMAX_DELAY);
  }
}

void RingStore::unlock() {
  if (mtx_) {
    xSemaphoreGiveRecursive(mtx_);
  }
}

bool RingStore::begin(uint16_t bootId) {
  if (!mtx_) {
    mtx_ = xSemaphoreCreateRecursiveMutex();
  }
  lock();
  boot_ = bootId;

  part_ = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)0x40, "ring");
  if (!part_) {
    ESP_LOGE(TAG, "failed to find 'ring' partition (0x40 subtype)");
    unlock();
    return false;
  }

  N_ = part_->size / SEC;
  ESP_LOGI(TAG, "found ring partition size %" PRIu32 " B (%" PRIu32 " sectors)",
           (uint32_t)part_->size, N_);

  bool any = false;
  uint32_t mn = 0xFFFFFFFF, mx = 0;
  SectorHdr h;
  for (uint32_t p = 0; p < N_; p++) {
    if (readHdrPhys(p, h)) {
      any = true;
      if (h.sseq < mn) mn = h.sseq;
      if (h.sseq > mx) mx = h.sseq;
    }
  }

  nextSseq_ = any ? mx + 1 : 0;

  // Read saved tail from NVS
  uint32_t as = 0xFFFFFFFF, ai = 0;
  nvs_handle_t nvs_h;
  if (nvs_open("rmp_ring", NVS_READONLY, &nvs_h) == ESP_OK) {
    nvs_get_u32(nvs_h, "ts", &as);
    nvs_get_u32(nvs_h, "ti", &ai);
    nvs_close(nvs_h);
  }

  if (!any) {
    tailS_ = nextSseq_;
    tailI_ = 0;
  } else if (as == 0xFFFFFFFF || as < mn) {
    tailS_ = mn;
    tailI_ = 0;
  } else if (as >= nextSseq_) {
    tailS_ = nextSseq_;
    tailI_ = 0;
  } else {
    tailS_ = as;
    tailI_ = ai;
  }

  savedS_ = tailS_;
  savedI_ = tailI_;
  curS_ = tailS_;
  curI_ = tailI_;
  pendS_ = curS_;
  pendI_ = curI_;
  want_ = {};
  for (auto& a : ack_) {
    a = {};
  }

  ESP_LOGI(TAG, "ring ready: nextSseq=%" PRIu32 " tailS=%" PRIu32 " tailI=%" PRIu32,
           nextSseq_, tailS_, tailI_);

  unlock();
  return true;
}

void RingStore::setMeta(uint8_t tsync, int64_t off, const char* attempt, uint16_t cal) {
  lock();
  bool ch = !open_ || tsync != hd_.tsync || cal != hd_.cal ||
            (attempt && strncmp(attempt, hd_.attempt, sizeof(hd_.attempt) - 1) != 0) ||
            (tsync == 2 && llabs(off - hd_.utcOffMs) > 250);
  want_.tsync = tsync;
  want_.utcOffMs = off;
  want_.cal = cal;
  if (attempt) {
    strncpy(want_.attempt, attempt, sizeof(want_.attempt) - 1);
    want_.attempt[sizeof(want_.attempt) - 1] = '\0';
  } else {
    want_.attempt[0] = '\0';
  }
  if (ch) rotate_ = true;
  unlock();
}

void RingStore::forceRotate() {
  lock();
  rotate_ = true;
  unlock();
}

bool RingStore::append(Rec& r) {
  lock();
  if (!open_ || rotate_ || hdIdx_ >= SLOTS) {
    startSector();
  }
  r.boot = boot_;
  r.crc = crc16(&r, REC - 2);
  bool ok = (esp_partition_write(part_, slotOff(hdSseq_, hdIdx_), &r, REC) == ESP_OK);
  hdIdx_++;
  unlock();
  return ok;
}

uint8_t RingStore::peek(View& v, uint8_t maxN) {
  lock();
  v.n = 0;
  uint32_t s = curS_, i = curI_, vs = 0;
  bool have = false;

  while (v.n < maxN && v.n < BACKLOG_N) {
    if (s >= nextSseq_) break;
    if (have && s != vs) break;
    uint32_t lim = limitFor(s);
    if (i >= lim) {
      if ((open_ && s == hdSseq_) || have) break;
      s++;
      i = 0;
      continue;
    }
    if (!have) {
      if (!readHdr(s, v.hdr)) {
        s++;
        i = 0;
        continue;
      }
      have = true;
      vs = s;
    }
    Rec r;
    uint8_t st = readRec(s, i, r);
    if (st == 2) {
      i = lim;
      continue;
    }
    if (st == 1) {
      v.rec[v.n++] = r;
    }
    i++;
  }
  pendS_ = s;
  pendI_ = i;
  uint8_t n = v.n;
  unlock();
  return n;
}

void RingStore::commitCursor() {
  lock();
  curS_ = pendS_;
  curI_ = pendI_;
  unlock();
}

void RingStore::rewindCursor() {
  lock();
  curS_ = tailS_;
  curI_ = tailI_;
  unlock();
}

bool RingStore::outstanding() {
  lock();
  bool out = (curS_ != tailS_ || curI_ != tailI_);
  unlock();
  return out;
}

void RingStore::onAck(uint16_t boot, uint32_t upto) {
  lock();
  int k = -1;
  for (int j = 0; j < 8; j++) {
    if (ack_[j].used && ack_[j].boot == boot) {
      k = j;
      break;
    }
  }
  if (k < 0) {
    k = ackRr_++ & 7;
    ack_[k].used = true;
    ack_[k].boot = boot;
    ack_[k].upto = 0;
  }
  if (upto > ack_[k].upto) ack_[k].upto = upto;

  for (;;) {
    if (tailS_ >= nextSseq_) break;
    uint32_t lim = limitFor(tailS_);
    if (tailI_ >= lim) {
      if (open_ && tailS_ == hdSseq_) break;
      tailS_++;
      tailI_ = 0;
      continue;
    }
    Rec r;
    uint8_t st = readRec(tailS_, tailI_, r);
    if (st == 2) {
      if (open_ && tailS_ == hdSseq_) break;
      tailS_++;
      tailI_ = 0;
      continue;
    }
    if (st == 0 || isAcked(r.boot, r.seq)) {
      tailI_++;
      continue;
    }
    break;
  }
  if (curS_ < tailS_ || (curS_ == tailS_ && curI_ < tailI_)) {
    curS_ = tailS_;
    curI_ = tailI_;
  }
  unlock();
}

void RingStore::persist() {
  lock();
  if (tailS_ != savedS_ || tailI_ != savedI_) {
    nvs_handle_t nvs_h;
    if (nvs_open("rmp_ring", NVS_READWRITE, &nvs_h) == ESP_OK) {
      nvs_set_u32(nvs_h, "ts", tailS_);
      nvs_set_u32(nvs_h, "ti", tailI_);
      nvs_commit(nvs_h);
      nvs_close(nvs_h);
      savedS_ = tailS_;
      savedI_ = tailI_;
    }
  }
  unlock();
}

uint32_t RingStore::pendingApprox() {
  lock();
  uint32_t end = open_ ? hdSseq_ * SLOTS + hdIdx_ : nextSseq_ * SLOTS;
  uint32_t c = curS_ * SLOTS + curI_;
  unlock();
  return end > c ? end - c : 0;
}

uint8_t RingStore::fillPercent() {
  lock();
  uint32_t used = nextSseq_ > tailS_ ? nextSseq_ - tailS_ : 0;
  uint8_t pct = (uint8_t)((used * 100) / (N_ ? N_ : 1));
  if (pct > 100) pct = 100;
  unlock();
  return pct;
}

uint32_t RingStore::takeLost() {
  lock();
  uint32_t l = lost_;
  lost_ = 0;
  unlock();
  return l;
}

bool RingStore::isAcked(uint16_t boot, uint32_t seq) const {
  for (int j = 0; j < 8; j++) {
    if (ack_[j].used && ack_[j].boot == boot && seq <= ack_[j].upto) return true;
  }
  return false;
}

bool RingStore::readHdrPhys(uint32_t p, SectorHdr& h) {
  if (!part_ || esp_partition_read(part_, (size_t)p * SEC, &h, HDR) != ESP_OK) return false;
  return h.magic == 0x524D5031 && h.crc == crc16(&h, HDR - 2) && (h.sseq % N_) == p;
}

bool RingStore::readHdr(uint32_t sseq, SectorHdr& h) {
  return readHdrPhys(sseq % N_, h) && h.sseq == sseq;
}

uint8_t RingStore::readRec(uint32_t s, uint32_t i, Rec& r) {
  uint8_t b[REC];
  if (!part_ || esp_partition_read(part_, slotOff(s, i), b, REC) != ESP_OK) return 0;
  bool blank = true;
  for (uint32_t k = 0; k < REC; k++) {
    if (b[k] != 0xFF) {
      blank = false;
      break;
    }
  }
  if (blank) return 2;
  memcpy(&r, b, REC);
  return r.crc == crc16(b, REC - 2) ? 1 : 0;
}

uint32_t RingStore::countValid(uint32_t s, uint32_t from) {
  uint32_t n = 0;
  Rec r;
  for (uint32_t i = from; i < SLOTS; i++) {
    uint8_t st = readRec(s, i, r);
    if (st == 2) break;
    if (st == 1) n++;
  }
  return n;
}

void RingStore::startSector() {
  uint32_t s = nextSseq_;
  if (s >= N_) {
    uint32_t v = s - N_;
    if (tailS_ <= v) {
      lost_ += countValid(v, tailS_ == v ? tailI_ : 0);
      tailS_ = v + 1;
      tailI_ = 0;
      if (curS_ < tailS_) {
        curS_ = tailS_;
        curI_ = 0;
      }
    }
  }
  esp_partition_erase_range(part_, (size_t)(s % N_) * SEC, SEC);
  SectorHdr h = want_;
  h.magic = 0x524D5031;
  h.sseq = s;
  h.boot = boot_;
  h.rsv = 0;
  h.crc = crc16(&h, HDR - 2);
  esp_partition_write(part_, (size_t)(s % N_) * SEC, &h, HDR);
  hd_ = h;
  hdSseq_ = s;
  hdIdx_ = 0;
  open_ = true;
  rotate_ = false;
  nextSseq_ = s + 1;
  if (tailS_ > s) {
    tailS_ = s;
    tailI_ = 0;
  }
}

}  // namespace rmp
