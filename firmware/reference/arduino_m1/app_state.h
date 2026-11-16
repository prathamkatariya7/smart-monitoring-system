#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <math.h>

// Temperature calibration: T_corrected = a * T_raw + b  (TDD 12.1, error = indicated - reference)
struct Calib {   // written by the net task, read by the sampler: a, b and ver change together under a spinlock
  float a = 1.0f, b = 0.0f; uint16_t ver = 0; portMUX_TYPE mux;
  Calib() { portMUX_INITIALIZE(&mux); }
  void set(float na, float nb, uint16_t nv) { portENTER_CRITICAL(&mux); a = na; b = nb; ver = nv; portEXIT_CRITICAL(&mux); }
  void load() { Preferences p; p.begin("cal", true); a = p.getFloat("a", 1.0f); b = p.getFloat("b", 0.0f); ver = p.getUShort("v", 0); p.end(); }
  void save() { Preferences p; p.begin("cal", false); p.putFloat("a", a); p.putFloat("b", b); p.putUShort("v", ver); p.end(); }
  float apply(float raw) { portENTER_CRITICAL(&mux); float x = ver ? a * raw + b : raw; portEXIT_CRITICAL(&mux); return x; }
};

// Latest values for the display / diagnostics (written by the sampler task)
struct Live {
  volatile float t = NAN, t_raw = NAN, rpm = 0, tq = 0;
  volatile uint8_t q = 0, flt = 0; volatile uint16_t flags = 0;
  volatile bool motorOk = false; volatile uint32_t seq = 0;
};

// Persisted process context so a reboot resumes acquisition without analyst action (TDD 5.3).
// Milestone 1: set from the serial console or cmd/set_assignment; the full state machine is milestone 2.
struct RunCtx {   // start/stop come from the net task or console, the sampler reads: copy out under a spinlock (no torn UUID)
  bool active = false; char attempt[40] = ""; portMUX_TYPE mux;
  RunCtx() { portMUX_INITIALIZE(&mux); }
  bool snapshot(char* out) { portENTER_CRITICAL(&mux); bool a = active; strlcpy(out, a ? attempt : "", 40); portEXIT_CRITICAL(&mux); return a; }
  void load() { Preferences p; p.begin("run", true); active = p.getBool("act", false); String s = p.getString("att", ""); p.end(); strlcpy(attempt, s.c_str(), sizeof attempt); }
  void start(const char* a) { portENTER_CRITICAL(&mux); active = true; strlcpy(attempt, a, sizeof attempt); portEXIT_CRITICAL(&mux); save(); }
  void stop() { portENTER_CRITICAL(&mux); active = false; attempt[0] = 0; portEXIT_CRITICAL(&mux); save(); }
  void save() { Preferences p; p.begin("run", false); p.putBool("act", active); p.putString("att", attempt); p.end(); }
};
