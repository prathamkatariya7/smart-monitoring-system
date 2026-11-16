#include "../config.h"
#include "../rmp_types.h"
#include "../ring_store.h"
SimFlash g_flash; std::map<std::string, uint32_t> g_nvs;

static int fails = 0, checks = 0;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("  FAIL line %d: %s  ", __LINE__, #c); printf(__VA_ARGS__); printf("\n"); } } while (0)

static Rec mk(uint32_t seq) { Rec r{}; r.seq = seq; r.mono_ms = seq * 1000; r.t = 25.0f + (seq % 100) * 0.01f; r.t_raw = r.t; r.rpm = 400; r.tq_x10 = 125; return r; }
struct Got { uint16_t boot; uint32_t seq; char att[40]; };

// drain everything currently pending, acking each batch like a healthy server
static void drain(RingStore& rs, std::vector<Got>& out, bool ack = true) {
  RingStore::View v; int guard = 0;
  while (rs.peek(v, 50) && guard++ < 100000) {
    for (int i = 0; i < v.n; i++) out.push_back({v.rec[i].boot, v.rec[i].seq, {0}}), strlcpy(out.back().att, v.hdr.attempt, 40);
    rs.commitCursor();
    if (ack) rs.onAck(v.rec[v.n - 1].boot, v.rec[v.n - 1].seq);
  }
}

static void test_happy() {
  printf("test 1: continuous delivery with lagging acks\n");
  g_flash.init(64); g_nvs.clear(); RingStore rs; CHECK(rs.begin(1), "begin");
  rs.setMeta(2, 1700000000000LL, "att-1", 3);
  std::vector<Got> got; RingStore::View v; uint32_t lastAcked = 0, N = 6000;
  for (uint32_t i = 1; i <= N; i++) {
    Rec r = mk(i); rs.append(r);
    if (i % 10 == 0) {
      while (rs.peek(v, 10)) { for (int k = 0; k < v.n; k++) got.push_back({v.rec[k].boot, v.rec[k].seq, {0}}); rs.commitCursor(); lastAcked = v.rec[v.n - 1].seq; if (v.n < 10) break; }
      if (i % 30 == 0 && lastAcked) rs.onAck(1, lastAcked - 5 > 0 ? lastAcked - 5 : lastAcked);   // ack lags the send
    }
  }
  while (rs.peek(v, 50)) { for (int k = 0; k < v.n; k++) got.push_back({v.rec[k].boot, v.rec[k].seq, {0}}); rs.commitCursor(); }
  rs.onAck(1, N);
  CHECK(got.size() == N, "delivered %zu of %u", got.size(), N);
  bool inorder = true; for (size_t i = 0; i < got.size(); i++) if (got[i].seq != i + 1) { inorder = false; break; }
  CHECK(inorder, "order/duplicates wrong");
  CHECK(!rs.outstanding(), "outstanding after full ack");
  CHECK(rs.takeLost() == 0, "unexpected loss");
}

static void test_overwrite() {
  printf("test 2: ring overflow with no acks -> exact GAP accounting\n");
  g_flash.init(8); g_nvs.clear(); RingStore rs; rs.begin(1); rs.setMeta(2, 0, "att-2", 1);
  uint32_t N = 8 * 144 * 3;
  for (uint32_t i = 1; i <= N; i++) { Rec r = mk(i); rs.append(r); }
  uint32_t lost = rs.takeLost();
  std::vector<Got> got; drain(rs, got);
  CHECK(lost + got.size() == N, "lost %u + delivered %zu != %u", lost, got.size(), N);
  CHECK(!got.empty() && got.back().seq == N, "newest record missing");
  bool contig = true; for (size_t i = 1; i < got.size(); i++) if (got[i].seq != got[i - 1].seq + 1) contig = false;
  CHECK(contig, "surviving records not contiguous");
  CHECK(lost > 0, "expected loss on overflow");
  printf("  lost=%u delivered=%zu (ring holds %u)\n", lost, got.size(), 8 * 144);
}

static void test_reboot() {
  printf("test 3: reboot persistence (tail from NVS, per-boot ack)\n");
  g_flash.init(64); g_nvs.clear(); uint32_t acked = 0;
  { RingStore rs; rs.begin(1); rs.setMeta(2, 0, "att-3", 1);
    for (uint32_t i = 1; i <= 500; i++) { Rec r = mk(i); rs.append(r); }
    RingStore::View v; uint32_t sent = 0;
    while (sent < 200 && rs.peek(v, 10)) { rs.commitCursor(); sent += v.n; rs.onAck(1, v.rec[v.n - 1].seq); }
    rs.persist(); acked = sent; printf("  acked through seq %u before 'power cut'\n", sent); }
  RingStore rs2; CHECK(rs2.begin(2), "begin after reboot"); rs2.setMeta(1, 0, "att-3", 1);
  for (uint32_t i = 1; i <= 50; i++) { Rec r = mk(i); rs2.append(r); }
  std::vector<Got> got; drain(rs2, got);
  uint32_t b1 = 0, b2 = 0, firstB1 = 0; for (auto& g : got) { if (g.boot == 1) { if (!b1) firstB1 = g.seq; b1++; } else b2++; }
  CHECK(firstB1 == acked + 1, "first replayed seq of boot 1 = %u (want %u)", firstB1, acked + 1);
  CHECK(b1 == 500 - acked, "boot-1 replay count %u (want %u)", b1, 500 - acked);
  CHECK(b2 == 50, "boot-2 count %u (want 50)", b2);
  CHECK(!rs2.outstanding(), "outstanding after drain");
}

static void test_meta() {
  printf("test 4: context change mid-stream never mixes headers\n");
  g_flash.init(64); g_nvs.clear(); RingStore rs; rs.begin(1);
  std::vector<std::string> want(1);
  for (uint32_t i = 1; i <= 900; i++) {
    const char* att = i <= 300 ? "" : (i <= 650 ? "att-A" : "att-B");
    rs.setMeta(2, 0, att, 1); Rec r = mk(i); rs.append(r); want.push_back(att);
  }
  RingStore::View v; bool clean = true; uint32_t n = 0;
  while (rs.peek(v, 50)) { for (int k = 0; k < v.n; k++) { n++; if (want[v.rec[k].seq] != v.hdr.attempt) clean = false; } rs.commitCursor(); rs.onAck(1, v.rec[v.n - 1].seq); }
  CHECK(n == 900, "delivered %u", n); CHECK(clean, "record shipped under the wrong attempt header");
}

static void test_corrupt() {
  printf("test 5: corrupted record is skipped, neighbours survive\n");
  g_flash.init(16); g_nvs.clear(); RingStore rs; rs.begin(1); rs.setMeta(2, 0, "att-5", 1);
  for (uint32_t i = 1; i <= 100; i++) { Rec r = mk(i); rs.append(r); }
  g_flash.mem[64 + 28 * 49 + 5] ^= 0x10;   // damage record #50 in sector 0 (clears a bit; a real bit-rot case)
  std::vector<Got> got; drain(rs, got);
  bool has50 = false; for (auto& g : got) if (g.seq == 50) has50 = true;
  CHECK(!has50 && got.size() == 99, "delivered %zu, has50=%d", got.size(), (int)has50);
}

int main() {
  test_happy(); test_overwrite(); test_reboot(); test_meta(); test_corrupt();
  CHECK(g_flash.norViolations == 0, "%ld writes needed a 0->1 transition (would corrupt real NOR flash)", g_flash.norViolations);
  printf("\n%d checks, %d failed, %ld sector erases\n", checks, fails, g_flash.erases);
  return fails ? 1 : 0;
}
