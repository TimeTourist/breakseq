#include "../src/Mixer.h"

#include <juce_core/juce_core.h>

namespace
{
    constexpr double rate = 100.0;

    /** A mono buffer of `length` frames at `bufferRate` whose frame i is i + 1, so a test sees which frame plays. */
    std::shared_ptr<const Mixer::Buffer> ramp (int length, double bufferRate = rate)
    {
        auto b = std::make_shared<Mixer::Buffer>();
        b->rate = bufferRate;
        b->channels.emplace_back();

        for (int i = 0; i < length; ++i)
            b->channels.back().push_back ((float) (i + 1));

        return b;
    }

    Mixer::Command bufferCommand (int id, std::shared_ptr<const Mixer::Buffer> b)
    {
        Mixer::Command c;
        c.op = Mixer::Op::buffer;
        c.id = id;
        c.buffer = std::move (b);
        return c;
    }

    Mixer::Command start (int id, int buffer, double when, double offset = 0.0, bool loop = false, int gain = 0)
    {
        Mixer::Command c;
        c.op = Mixer::Op::start;
        c.id = id;
        c.bufferId = buffer;
        c.time = when;
        c.offset = offset;
        c.loop = loop;
        c.gain = gain;
        return c;
    }

    /** Runs the mixer for `frames` frames and gives back the left channel. */
    std::vector<float> render (Mixer& mixer, int frames)
    {
        juce::AudioBuffer<float> out (2, frames);
        out.clear();
        mixer.process (out, rate);
        return { out.getReadPointer (0), out.getReadPointer (0) + frames };
    }
}

class MixerTests final : public juce::UnitTest
{
public:
    MixerTests() : juce::UnitTest ("Mixer", "Breakseq") {}

    void expectFrames (const std::vector<float>& actual, const std::vector<float>& expected)
    {
        auto text = [] (const std::vector<float>& v)
        {
            juce::StringArray parts;
            for (auto x : v)
                parts.add (juce::String (x, 3));
            return "{" + parts.joinIntoString (", ") + "}";
        };

        bool same = actual.size() == expected.size();

        for (size_t i = 0; same && i < actual.size(); ++i)
            same = std::abs (actual[i] - expected[i]) < 1e-3f;

        expect (same, "Expected " + text (expected) + ", got " + text (actual));
    }

    void expectIds (const std::vector<int>& actual, const std::vector<int>& expected)
    {
        expect (actual == expected, "Expected " + juce::String ((int) expected.size()) + " ended ids, got " + juce::String ((int) actual.size()));
    }

    void runTest() override
    {
        beginTest ("starts a buffer on its frame and plays it out once");
        {
            Mixer mixer;
            mixer.post ({ bufferCommand (1, ramp (3)), start (2, 1, 0.02) });
            const auto out = render (mixer, 6);
            expectFrames (out, { 0, 0, 1, 2, 3, 0 });
            expectIds (mixer.takeEnded(), { 2 });
        }

        beginTest ("a start that arrives late plays from where it would be by now");
        {
            Mixer mixer;
            render (mixer, 5);
            mixer.post ({ bufferCommand (1, ramp (10)), start (2, 1, 0.02) });
            expectFrames (render (mixer, 2), { 4, 5 });
        }

        beginTest ("loops its loop range, and a stop ends it on its frame");
        {
            Mixer mixer;
            auto c = start (2, 1, 0.0, 0.0, true);
            c.loopStart = 0.01;
            c.loopEnd = 0.03;
            Mixer::Command stop;
            stop.op = Mixer::Op::stop;
            stop.id = 2;
            stop.time = 0.07;
            mixer.post ({ bufferCommand (1, ramp (5)), c, stop });
            expectFrames (render (mixer, 9), { 1, 2, 3, 2, 3, 2, 3, 0, 0 });
            expectIds (mixer.takeEnded(), { 2 });
        }

        beginTest ("follows a gain's set and linear ramp events");
        {
            Mixer mixer;
            auto ones = std::make_shared<Mixer::Buffer>();
            ones->rate = rate;
            ones->channels.push_back (std::vector<float> (10, 1.0f));
            Mixer::Command gain;
            gain.op = Mixer::Op::gain;
            gain.id = 5;
            gain.value = 1.0;
            Mixer::Command set;
            set.op = Mixer::Op::gainSet;
            set.id = 5;
            set.time = 0.0;
            set.value = 0.0;
            Mixer::Command rampTo;
            rampTo.op = Mixer::Op::gainRamp;
            rampTo.id = 5;
            rampTo.time = 0.04;
            rampTo.value = 1.0;
            mixer.post ({ bufferCommand (1, ones), gain, set, rampTo, start (2, 1, 0.0, 0.0, false, 5) });
            expectFrames (render (mixer, 6), { 0.0f, 0.25f, 0.5f, 0.75f, 1.0f, 1.0f });
        }

        beginTest ("plays a buffer at another sample rate at its own speed");
        {
            Mixer mixer;
            mixer.post ({ bufferCommand (1, ramp (10, 200.0)), start (2, 1, 0.0) });
            expectFrames (render (mixer, 3), { 1, 3, 5 });
        }

        beginTest ("stopAll ends everything");
        {
            Mixer mixer;
            mixer.post ({ bufferCommand (1, ramp (100)), start (2, 1, 0.0, 0.0, true), start (3, 1, 0.0) });
            render (mixer, 2);
            mixer.post ({ Mixer::Command {} });
            expectFrames (render (mixer, 2), { 0, 0 });
            expectEquals ((int) mixer.takeEnded().size(), 2);
        }

        beginTest ("reads a batch from the page");
        {
            juce::MemoryOutputStream floats;
            floats.writeFloat (0.5f);
            floats.writeFloat (-0.25f);
            const auto json = R"([{"op":"buffer","id":1,"rate":48000,"channels":[")" + juce::Base64::toBase64 (floats.getData(), floats.getDataSize())
                              + R"("]},{"op":"start","id":2,"buffer":1,"gain":0,"when":1.5,"offset":0,"duration":-1,"loop":true,"loopStart":0,"loopEnd":0},{"op":"nonsense"}])";
            const auto commands = Mixer::parse (juce::JSON::parse (json));
            expectEquals ((int) commands.size(), 2);
            expect (commands[0].op == Mixer::Op::buffer);
            expectFrames (commands[0].buffer->channels[0], { 0.5f, -0.25f });
            expect (commands[1].op == Mixer::Op::start && commands[1].loop);
            expectEquals (commands[1].time, 1.5);
        }
    }
};

static MixerTests mixerTests;
