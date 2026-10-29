#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

/**
 * The phase 0 test clip: four quarter notes on C1 over one bar of 4/4, at
 * `bpm`, as a standard MIDI file (format 1, 960 ticks per quarter note).
 */
juce::MemoryBlock testMidiClip (double bpm);

/** Writes testMidiClip to a fresh file in the temp folder and returns it. */
juce::File writeTestMidiClip (double bpm);
