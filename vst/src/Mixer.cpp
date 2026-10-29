#include "Mixer.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace
{
    std::shared_ptr<const Mixer::Buffer> decodeBuffer (const juce::var& command)
    {
        auto buffer = std::make_shared<Mixer::Buffer>();
        buffer->rate = (double) command["rate"];

        if (const auto* channels = command["channels"].getArray())
        {
            for (const auto& channel : *channels)
            {
                juce::MemoryOutputStream bytes;

                if (! juce::Base64::convertFromBase64 (bytes, channel.toString()))
                    return nullptr;

                std::vector<float> data (bytes.getDataSize() / sizeof (float));
                std::memcpy (data.data(), bytes.getData(), data.size() * sizeof (float));
                buffer->channels.push_back (std::move (data));
            }
        }

        if (buffer->rate <= 0.0 || buffer->channels.empty())
            return nullptr;

        return buffer;
    }
}

std::vector<Mixer::Command> Mixer::parse (const juce::var& batch)
{
    static const std::unordered_map<juce::String, Op> ops {
        { "buffer", Op::buffer }, { "release", Op::release }, { "gain", Op::gain }, { "gainValue", Op::gainValue },
        { "gainSet", Op::gainSet }, { "gainRamp", Op::gainRamp }, { "start", Op::start }, { "loop", Op::loop },
        { "stop", Op::stop }, { "stopAll", Op::stopAll },
    };

    std::vector<Command> commands;

    if (const auto* items = batch.getArray())
    {
        for (const auto& item : *items)
        {
            const auto found = ops.find (item["op"].toString());

            if (found == ops.end())
                continue;

            Command c;
            c.op = found->second;
            c.id = (int) item["id"];

            switch (c.op)
            {
                case Op::buffer:
                    c.buffer = decodeBuffer (item);
                    if (c.buffer == nullptr)
                        continue;
                    break;
                case Op::gain:
                case Op::gainValue:
                    c.value = (double) item["value"];
                    break;
                case Op::gainSet:
                case Op::gainRamp:
                    c.time = (double) item["time"];
                    c.value = (double) item["value"];
                    break;
                case Op::start:
                    c.bufferId = (int) item["buffer"];
                    c.gain = (int) item["gain"];
                    c.time = (double) item["when"];
                    c.offset = (double) item["offset"];
                    c.duration = (double) item["duration"];
                    c.loop = (bool) item["loop"];
                    c.loopStart = (double) item["loopStart"];
                    c.loopEnd = (double) item["loopEnd"];
                    break;
                case Op::loop:
                    c.loop = (bool) item["loop"];
                    c.loopStart = (double) item["loopStart"];
                    c.loopEnd = (double) item["loopEnd"];
                    break;
                case Op::stop:
                    c.time = (double) item["when"];
                    break;
                case Op::release:
                case Op::stopAll:
                    break;
            }

            commands.push_back (std::move (c));
        }
    }

    return commands;
}

void Mixer::post (std::vector<Command> commands)
{
    const juce::SpinLock::ScopedLockType lock (queueLock);

    for (auto& c : commands)
        queued.push_back (std::move (c));
}

double Mixer::Gain::valueAt (double t) const
{
    // As Web Audio: before the first event the plain value; a ramp runs from the event before it.
    double before = value;
    double from = 0.0;
    bool started = false;

    for (const auto& e : events)
    {
        if (e.time > t)
        {
            if (e.ramp && started && e.time > from)
                return before + (e.value - before) * (t - from) / (e.time - from);

            return before;
        }

        before = e.value;
        from = e.time;
        started = true;
    }

    return before;
}

void Mixer::apply (const Command& c)
{
    switch (c.op)
    {
        case Op::buffer:
            buffers[c.id] = c.buffer;
            break;

        case Op::release:
        {
            const auto found = buffers.find (c.id);

            if (found != buffers.end())
            {
                // Freed on the message thread, not here.
                const juce::SpinLock::ScopedTryLockType lock (graveLock);

                if (lock.isLocked())
                {
                    grave.push_back (found->second);
                    buffers.erase (found);
                }
            }
            break;
        }

        case Op::gain:
            gains[c.id].value = c.value;
            break;

        case Op::gainValue:
            gains[c.id].value = c.value;
            break;

        case Op::gainSet:
        case Op::gainRamp:
        {
            auto& events = gains[c.id].events;
            const Event e { c.time, c.value, c.op == Op::gainRamp };
            // Kept in time order; events at the same time stay in the order given.
            const auto at = std::upper_bound (events.begin(), events.end(), e.time, [] (double t, const Event& x) { return t < x.time; });
            events.insert (at, e);
            break;
        }

        case Op::start:
        {
            const auto found = buffers.find (c.bufferId);

            if (found == buffers.end())
                break;

            Source s;
            s.id = c.id;
            s.buffer = found->second;
            s.gain = c.gain;
            s.when = c.time;
            s.offset = c.offset;
            s.duration = c.duration;
            s.loop = c.loop;
            s.loopStart = c.loopStart;
            s.loopEnd = c.loopEnd;

            if (s.gain != 0)
            {
                auto& g = gains[s.gain];
                g.sources++;
                g.used = true;
            }

            sources.push_back (std::move (s));
            break;
        }

        case Op::loop:
            for (auto& s : sources)
            {
                if (s.id == c.id)
                {
                    s.loop = c.loop;
                    s.loopStart = c.loopStart;
                    s.loopEnd = c.loopEnd;
                }
            }
            break;

        case Op::stop:
            for (auto& s : sources)
                if (s.id == c.id)
                    s.stopAt = std::min (s.stopAt, c.time);
            break;

        case Op::stopAll:
            for (auto& s : sources)
                s.stopAt = 0.0;
            break;
    }
}

void Mixer::end (Source& s)
{
    int start1, size1, start2, size2;
    endedFifo.prepareToWrite (1, start1, size1, start2, size2);

    if (size1 > 0)
        endedIds[(size_t) start1] = s.id;
    else if (size2 > 0)
        endedIds[(size_t) start2] = s.id;

    endedFifo.finishedWrite (size1 + size2);

    if (s.gain != 0)
    {
        const auto found = gains.find (s.gain);

        if (found != gains.end() && --found->second.sources <= 0 && found->second.used)
            gains.erase (found);
    }
}

void Mixer::process (juce::AudioBuffer<float>& out, double rate)
{
    hostRate.store (rate);

    {
        const juce::SpinLock::ScopedTryLockType lock (queueLock);

        if (lock.isLocked())
            taking.swap (queued);
    }

    for (const auto& c : taking)
        apply (c);

    taking.clear();

    const auto frames = out.getNumSamples();
    const auto outChannels = out.getNumChannels();
    const auto step = 1.0 / rate;

    for (auto& s : sources)
    {
        const auto& buffer = *s.buffer;
        const auto duration = buffer.duration();
        const auto gainFound = s.gain == 0 ? gains.end() : gains.find (s.gain);
        const Gain* gain = gainFound == gains.end() ? nullptr : &gainFound->second;
        bool done = false;

        for (int i = 0; i < frames && ! done; ++i)
        {
            const auto t = (double) (samples + i) * step;

            if (t >= s.stopAt)
            {
                done = true;
                break;
            }

            if (! s.started)
            {
                if (t + step <= s.when)
                    continue;

                // Late, it starts as far in as it would be by now.
                const auto late = std::max (0.0, t - s.when);
                s.started = true;
                s.position = s.offset + late;
                s.played = late;
            }

            const auto loopStart = s.loopEnd > s.loopStart ? s.loopStart : 0.0;
            const auto loopEnd = s.loopEnd > s.loopStart ? std::min (s.loopEnd, duration) : duration;

            if (s.loop && loopEnd > loopStart)
                while (s.position >= loopEnd)
                    s.position -= loopEnd - loopStart;

            if ((! s.loop && s.position >= duration) || (s.duration >= 0.0 && s.played >= s.duration))
            {
                done = true;
                break;
            }

            const auto at = s.position * buffer.rate;
            const auto index = (size_t) at;
            const auto frac = (float) (at - (double) index);
            const auto level = (float) (gain == nullptr ? 1.0 : gain->valueAt (t));

            for (int ch = 0; ch < outChannels; ++ch)
            {
                const auto& data = buffer.channels[std::min ((size_t) ch, buffer.channels.size() - 1)];
                const auto a = index < data.size() ? data[index] : 0.0f;
                const auto b = index + 1 < data.size() ? data[index + 1] : 0.0f;
                out.addSample (ch, i, (a + (b - a) * frac) * level);
            }

            s.position += step;
            s.played += step;
        }

        if (done)
        {
            end (s);
            s.id = -1;
        }
    }

    sources.erase (std::remove_if (sources.begin(), sources.end(), [] (const Source& s) { return s.id == -1; }), sources.end());

    samples += frames;
    clock.store ((double) samples * step);
}

std::vector<int> Mixer::takeEnded()
{
    std::vector<int> ids;
    int start1, size1, start2, size2;
    endedFifo.prepareToRead (endedFifo.getNumReady(), start1, size1, start2, size2);

    for (int i = 0; i < size1; ++i)
        ids.push_back (endedIds[(size_t) (start1 + i)]);

    for (int i = 0; i < size2; ++i)
        ids.push_back (endedIds[(size_t) (start2 + i)]);

    endedFifo.finishedRead (size1 + size2);

    const juce::SpinLock::ScopedLockType lock (graveLock);
    grave.erase (std::remove_if (grave.begin(), grave.end(), [] (const auto& b) { return b.use_count() == 1; }), grave.end());

    return ids;
}
