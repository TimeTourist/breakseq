#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>

#include <atomic>
#include <limits>
#include <memory>
#include <unordered_map>
#include <vector>

/**
 * Plays what the page's player schedules (vst/web/src/ui/plugin/remote-audio.ts):
 * buffers started at a time on Reason's sample clock, looped or not, through
 * gains with set and linear-ramp events, as Web Audio does. A start that
 * arrives late plays from where it would be by now, so it stays in time.
 *
 * Commands come from the message thread (post) and are taken in by the audio
 * thread at the start of a block (process); the audio thread never waits for
 * them. Ended sources go back the other way (takeEnded).
 */
class Mixer
{
public:
    struct Buffer
    {
        double rate = 44100.0;
        std::vector<std::vector<float>> channels;

        size_t length() const { return channels.empty() ? 0 : channels.front().size(); }
        double duration() const { return (double) length() / rate; }
    };

    enum class Op { buffer, release, gain, gainValue, gainSet, gainRamp, start, loop, stop, stopAll };

    struct Command
    {
        Op op = Op::stopAll;
        int id = 0;
        std::shared_ptr<const Buffer> buffer; // Op::buffer
        int bufferId = 0;                      // Op::start
        int gain = 0;                          // Op::start: 0 is straight to the output
        double time = 0.0;                     // gainSet, gainRamp, start (when), stop (when)
        double value = 0.0;                    // gain, gainValue, gainSet, gainRamp
        double offset = 0.0;                   // start
        double duration = -1.0;                // start: -1 is until stopped or played out
        bool loop = false;                     // start, loop
        double loopStart = 0.0;                // start, loop
        double loopEnd = 0.0;                  // start, loop
    };

    /** Reads a batch the page sent ("audio" native function) into commands; skips what it cannot read. */
    static std::vector<Command> parse (const juce::var& batch);

    /** Message thread: queues commands for the next block. */
    void post (std::vector<Command> commands);

    /** Audio thread: takes in the queued commands, then adds the block's sound to `out` (cleared by the caller). */
    void process (juce::AudioBuffer<float>& out, double hostRate);

    /** Seconds on the clock: samples processed so far over the host's sample rate. */
    double now() const { return clock.load(); }
    double rate() const { return hostRate.load(); }

    /** Message thread: the ids of sources that ended since last asked. Also lets go of released buffers. */
    std::vector<int> takeEnded();

private:
    struct Event
    {
        double time;
        double value;
        bool ramp;
    };

    struct Gain
    {
        double value = 1.0;
        std::vector<Event> events;
        int sources = 0;
        bool used = false;

        double valueAt (double t) const;
    };

    struct Source
    {
        int id = 0;
        std::shared_ptr<const Buffer> buffer;
        int gain = 0;
        double when = 0.0;
        double offset = 0.0;
        double duration = -1.0;
        bool loop = false;
        double loopStart = 0.0;
        double loopEnd = 0.0;
        double stopAt = std::numeric_limits<double>::infinity();
        bool started = false;
        double position = 0.0; // seconds into the buffer
        double played = 0.0;   // seconds since it started
    };

    void apply (const Command&);
    void end (Source&);

    juce::SpinLock queueLock;
    std::vector<Command> queued;
    std::vector<Command> taking;

    std::unordered_map<int, std::shared_ptr<const Buffer>> buffers;
    std::unordered_map<int, Gain> gains;
    std::vector<Source> sources;

    // Buffers let go of: freed on the message thread once no source plays them.
    juce::SpinLock graveLock;
    std::vector<std::shared_ptr<const Buffer>> grave;

    juce::AbstractFifo endedFifo { 4096 };
    std::vector<int> endedIds = std::vector<int> (4096);

    juce::int64 samples = 0;
    std::atomic<double> clock { 0.0 };
    std::atomic<double> hostRate { 44100.0 };
};
