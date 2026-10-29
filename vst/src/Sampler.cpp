#include "Sampler.h"

#include <algorithm>
#include <cstring>
#include <utility>

void Sampler::setPieces (std::shared_ptr<const Pieces> pieces)
{
    std::shared_ptr<const Pieces> old;

    {
        const juce::SpinLock::ScopedLockType lock (currentLock);
        old = std::exchange (current, std::move (pieces));
    }

    // The audio thread may still hold the old ones: they are freed later, here, not there.
    const juce::ScopedLock lock (retiredLock);

    if (old != nullptr)
        retired.push_back (std::move (old));
}

std::shared_ptr<const Sampler::Pieces> Sampler::getPieces() const
{
    const juce::SpinLock::ScopedLockType lock (currentLock);
    return current;
}

void Sampler::collectGarbage()
{
    const juce::ScopedLock lock (retiredLock);
    retired.erase (std::remove_if (retired.begin(), retired.end(), [] (const auto& p) { return p.use_count() == 1; }), retired.end());
}

void Sampler::noteOn (int key, float velocity, int fadeSamples)
{
    const auto piece = key - firstNote;

    if (playing == nullptr || piece < 0 || (size_t) piece >= playing->sounds.size())
        return;

    // The same key again starts the piece again: what played fades out under it.
    noteOff (key, fadeSamples);

    auto* voice = std::find_if (voices.begin(), voices.end(), [] (const Voice& v) { return ! v.active; });

    if (voice == voices.end())
        voice = std::max_element (voices.begin(), voices.end(), [] (const Voice& a, const Voice& b) { return a.position < b.position; });

    *voice = Voice { key, (size_t) piece, 0.0, velocity, -1, true };
}

void Sampler::noteOff (int key, int fadeSamples)
{
    for (auto& v : voices)
        if (v.active && v.key == key && v.fadeLeft < 0)
            v.fadeLeft = fadeSamples;
}

void Sampler::render (juce::AudioBuffer<float>& out, int from, int to, double hostRate, int fadeSamples)
{
    if (playing == nullptr)
        return;

    const auto step = 1.0 / hostRate;

    for (auto& v : voices)
    {
        if (! v.active)
            continue;

        const auto& sound = playing->sounds[v.piece];
        const auto length = sound[0].size();

        for (int i = from; i < to; ++i)
        {
            const auto at = v.position * playing->rate;
            const auto index = (size_t) at;

            if (index >= length || v.fadeLeft == 0)
            {
                v.active = false;
                break;
            }

            const auto frac = (float) (at - (double) index);
            auto level = v.level;

            if (v.fadeLeft > 0)
            {
                level *= (float) v.fadeLeft / (float) std::max (1, fadeSamples);
                --v.fadeLeft;
            }

            for (int ch = 0; ch < out.getNumChannels(); ++ch)
            {
                const auto& data = sound[(size_t) std::min (ch, 1)];
                const auto a = data[index];
                const auto b = index + 1 < length ? data[index + 1] : 0.0f;
                out.addSample (ch, i, (a + (b - a) * frac) * level);
            }

            v.position += step;
        }
    }
}

void Sampler::process (juce::AudioBuffer<float>& out, const juce::MidiBuffer& midi, double hostRate)
{
    std::shared_ptr<const Pieces> now = playing;

    {
        const juce::SpinLock::ScopedTryLockType lock (currentLock);

        if (lock.isLocked())
            now = current;
    }

    if (now != playing)
    {
        // New pieces: what played was the old ones' and stops. The old ones are freed on the message thread.
        for (auto& v : voices)
            v.active = false;

        playing = std::move (now);
    }

    const auto fadeSamples = std::max (1, (int) std::round (fadeSeconds * hostRate));
    int done = 0;

    for (const auto metadata : midi)
    {
        const auto at = juce::jlimit (0, out.getNumSamples(), metadata.samplePosition);
        render (out, done, at, hostRate, fadeSamples);
        done = at;

        const auto message = metadata.getMessage();

        if (message.isNoteOn())
            noteOn (message.getNoteNumber(), (float) message.getVelocity() / 100.0f, fadeSamples);
        else if (message.isNoteOff())
            noteOff (message.getNoteNumber(), fadeSamples);
        else if (message.isAllNotesOff() || message.isAllSoundOff())
            for (auto& v : voices)
                if (v.active && v.fadeLeft < 0)
                    v.fadeLeft = fadeSamples;
    }

    render (out, done, out.getNumSamples(), hostRate, fadeSamples);
}

namespace
{
    constexpr juce::uint32 magic = 0x50515342; // "BSQP"
}

juce::MemoryBlock Sampler::write (const Pieces& pieces)
{
    juce::MemoryOutputStream out;
    out.writeInt ((int) magic);
    out.writeInt (1);
    out.writeDouble (pieces.rate);
    out.writeDouble (pieces.bpm);
    out.writeString (pieces.fingerprint);
    out.writeInt ((int) pieces.sounds.size());

    for (const auto& sound : pieces.sounds)
    {
        out.writeInt ((int) sound[0].size());

        for (const auto& channel : sound)
            out.write (channel.data(), channel.size() * sizeof (float));
    }

    return out.getMemoryBlock();
}

std::shared_ptr<const Sampler::Pieces> Sampler::read (const juce::MemoryBlock& bytes)
{
    juce::MemoryInputStream in (bytes, false);

    if (bytes.getSize() < 8 || (juce::uint32) in.readInt() != magic || in.readInt() != 1)
        return nullptr;

    auto pieces = std::make_shared<Pieces>();
    pieces->rate = in.readDouble();
    pieces->bpm = in.readDouble();
    pieces->fingerprint = in.readString();
    const auto count = in.readInt();

    if (count < 0 || count > 128 || pieces->rate <= 0.0)
        return nullptr;

    for (int i = 0; i < count; ++i)
    {
        const auto length = in.readInt();

        if (length < 0 || (juce::int64) length * 2 * (juce::int64) sizeof (float) > in.getNumBytesRemaining())
            return nullptr;

        std::array<std::vector<float>, 2> sound;

        for (auto& channel : sound)
        {
            channel.resize ((size_t) length);
            in.read (channel.data(), (int) (channel.size() * sizeof (float)));
        }

        pieces->sounds.push_back (std::move (sound));
    }

    return pieces;
}
