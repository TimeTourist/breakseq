#include "../src/Sampler.h"

#include <juce_core/juce_core.h>

namespace
{
    constexpr double rate = 1000.0; // a fade of 3 ms is 3 samples

    /** Pieces whose sound n is a constant n + 1, `length` samples long, in both channels. */
    std::shared_ptr<const Sampler::Pieces> constants (int count, int length)
    {
        auto p = std::make_shared<Sampler::Pieces>();
        p->rate = rate;
        p->bpm = 172.0;
        p->fingerprint = "test";

        for (int n = 0; n < count; ++n)
            p->sounds.push_back ({ std::vector<float> ((size_t) length, (float) (n + 1)), std::vector<float> ((size_t) length, (float) (n + 1)) });

        return p;
    }

    std::vector<float> play (Sampler& sampler, const juce::MidiBuffer& midi, int frames)
    {
        juce::AudioBuffer<float> out (2, frames);
        out.clear();
        sampler.process (out, midi, rate);
        return { out.getReadPointer (1), out.getReadPointer (1) + frames };
    }
}

class SamplerTests final : public juce::UnitTest
{
public:
    SamplerTests() : juce::UnitTest ("Sampler", "Breakseq") {}

    void expectFrames (const std::vector<float>& actual, const std::vector<float>& expected)
    {
        juce::StringArray a, e;
        for (auto x : actual)
            a.add (juce::String (x, 3));
        for (auto x : expected)
            e.add (juce::String (x, 3));

        bool same = actual.size() == expected.size();
        for (size_t i = 0; same && i < actual.size(); ++i)
            same = std::abs (actual[i] - expected[i]) < 1e-3f;

        expect (same, "Expected {" + e.joinIntoString (", ") + "}, got {" + a.joinIntoString (", ") + "}");
    }

    void runTest() override
    {
        beginTest ("a note from C1 up starts its piece on its sample, at velocity / 100");
        {
            Sampler sampler;
            sampler.setPieces (constants (2, 100));
            juce::MidiBuffer midi;
            midi.addEvent (juce::MidiMessage::noteOn (1, 37, (juce::uint8) 50), 2);
            expectFrames (play (sampler, midi, 4), { 0, 0, 1, 1 });
        }

        beginTest ("note-off fades out over 3 ms, and a key with no piece plays nothing");
        {
            Sampler sampler;
            sampler.setPieces (constants (1, 100));
            juce::MidiBuffer midi;
            midi.addEvent (juce::MidiMessage::noteOn (1, 36, (juce::uint8) 100), 0);
            midi.addEvent (juce::MidiMessage::noteOn (1, 90, (juce::uint8) 100), 0);
            midi.addEvent (juce::MidiMessage::noteOff (1, 36), 2);
            expectFrames (play (sampler, midi, 7), { 1, 1, 1, 2.0f / 3.0f, 1.0f / 3.0f, 0, 0 });
        }

        beginTest ("a piece plays out and stops; keys sound together");
        {
            Sampler sampler;
            sampler.setPieces (constants (2, 3));
            juce::MidiBuffer midi;
            midi.addEvent (juce::MidiMessage::noteOn (1, 36, (juce::uint8) 100), 0);
            midi.addEvent (juce::MidiMessage::noteOn (1, 37, (juce::uint8) 100), 1);
            expectFrames (play (sampler, midi, 5), { 1, 3, 3, 2, 0 });
        }

        beginTest ("the same key again starts the piece again, the old one fading under it");
        {
            Sampler sampler;
            auto p = std::make_shared<Sampler::Pieces>();
            p->rate = rate;
            p->sounds.push_back ({ std::vector<float> { 1, 2, 3, 4, 5, 6, 7, 8 }, std::vector<float> { 1, 2, 3, 4, 5, 6, 7, 8 } });
            sampler.setPieces (p);
            juce::MidiBuffer midi;
            midi.addEvent (juce::MidiMessage::noteOn (1, 36, (juce::uint8) 100), 0);
            midi.addEvent (juce::MidiMessage::noteOn (1, 36, (juce::uint8) 100), 3);
            // At 3 the old voice (4, 5, 6 at 3/3, 2/3, 1/3) fades under the new one (1, 2, 3).
            expectFrames (play (sampler, midi, 7), { 1, 2, 3, 1 + 4, 2 + 5 * 2.0f / 3.0f, 3 + 6 * 1.0f / 3.0f, 4 });
        }

        beginTest ("new pieces stop what played");
        {
            Sampler sampler;
            sampler.setPieces (constants (1, 100));
            juce::MidiBuffer on;
            on.addEvent (juce::MidiMessage::noteOn (1, 36, (juce::uint8) 100), 0);
            play (sampler, on, 2);
            sampler.setPieces (constants (1, 100));
            expectFrames (play (sampler, {}, 2), { 0, 0 });
            sampler.collectGarbage();
        }

        beginTest ("the pieces go into the song's state and come back");
        {
            const auto pieces = constants (3, 5);
            const auto back = Sampler::read (Sampler::write (*pieces));
            expect (back != nullptr);
            expectEquals (back->bpm, 172.0);
            expectEquals (back->fingerprint, juce::String ("test"));
            expectEquals ((int) back->sounds.size(), 3);
            expectFrames (back->sounds[2][1], { 3, 3, 3, 3, 3 });
            expect (Sampler::read (juce::MemoryBlock ("nonsense", 8)) == nullptr);
        }
    }
};

static SamplerTests samplerTests;
