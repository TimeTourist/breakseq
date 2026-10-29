// Writes src/test/rex-golden.rx2 with VelociLoops (https://github.com/kunitoki/VelociLoops),
// for src/engine/rex.test.ts to compare the TypeScript writer with, byte for byte.
// Build: g++ -std=c++17 -I VelociLoops/include VelociLoops/src/velociloops.cpp src/test/rex-golden.cpp -o rex-golden
// The samples are k/1024 and k/2048, exact in 32-bit floats, so both sides round them the same.
#include "velociloops.h"
#include <cassert>
#include <cmath>
#include <cstdio>
#include <vector>

float leftAt(int slice, int i) { return (float)(((i * 7919 + slice * 31) % 2001) - 1000) / 1024.0f; }
float rightAt(int slice, int i) { return (float)(((i * 104729 + slice * 17) % 1999) - 999) / 2048.0f; }

int main(int argc, char** argv) {
  const int rate = 44100, bpm = 120, total = 22050; // one beat
  const int lengths[] = {300, 500, 700};
  VLError err;
  VLFile f = vl_create_new(2, rate, bpm * 1000, &err);
  VLFileInfo info;
  vl_get_info(f, &info);
  info.ppq_length = 15360;
  info.time_sig_num = 4;
  info.time_sig_den = 4;
  info.bit_depth = 24;
  info.total_frames = total;
  info.loop_start = 0;
  info.loop_end = total;
  assert(vl_set_info(f, &info) == VL_OK);
  int start = 0;
  for (int k = 0; k < 3; k++) {
    // The last slice runs to the end of the beat, padded with silence.
    const int frames = k == 2 ? total - start : lengths[k];
    std::vector<float> l(frames, 0.0f), r(frames, 0.0f);
    for (int i = 0; i < lengths[k]; i++) { l[i] = leftAt(k, i); r[i] = rightAt(k, i); }
    const int ppq = (int)llround((double)start * 15360 / total);
    assert(vl_add_slice(f, ppq, l.data(), r.data(), frames) == k);
    start += lengths[k];
  }
  assert(vl_save(f, argc > 1 ? argv[1] : "rex-golden.rx2") == VL_OK);
  vl_close(f);
  return 0;
}
