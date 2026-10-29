#include "MidiClip.h"

namespace
{
    constexpr int ticksPerQuarter = 960;
    constexpr int note = 36;
}

juce::MemoryBlock testMidiClip (double bpm)
{
    juce::MidiMessageSequence track;
    track.addEvent (juce::MidiMessage::textMetaEvent (3, "Breakseq"), 0);
    track.addEvent (juce::MidiMessage::tempoMetaEvent ((int) std::round (60000000.0 / bpm)), 0);
    track.addEvent (juce::MidiMessage::timeSignatureMetaEvent (4, 4), 0);

    for (int beat = 0; beat < 4; ++beat)
    {
        const auto start = beat * ticksPerQuarter;
        track.addEvent (juce::MidiMessage::noteOn (1, note, (juce::uint8) 100), start);
        track.addEvent (juce::MidiMessage::noteOff (1, note), start + ticksPerQuarter / 2);
    }

    track.addEvent (juce::MidiMessage::endOfTrack(), 4 * ticksPerQuarter);
    track.updateMatchedPairs();

    juce::MidiFile file;
    file.setTicksPerQuarterNote (ticksPerQuarter);
    file.addTrack (track);

    juce::MemoryOutputStream out;
    file.writeTo (out, 1);
    return out.getMemoryBlock();
}

juce::File writeTestMidiClip (double bpm)
{
    const auto folder = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("Breakseq");
    folder.createDirectory();

    const auto file = folder.getChildFile ("breakseq-" + juce::String (juce::roundToInt (bpm)) + "bpm.mid");
    const auto clip = testMidiClip (bpm);
    file.replaceWithData (clip.getData(), clip.getSize());
    return file;
}
