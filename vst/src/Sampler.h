#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>

#include <array>
#include <memory>
#include <vector>

/**
 * Plays the pieces Song to MIDI froze (docs/vst-spec.md): note C1 + n starts
 * piece n from its start, a new note on the same key starts it again, keys
 * sound together, and a note-off ends a piece with a short fade, as a choke
 * does in the web app. Velocity 100 is the level heard in the plugin.
 *
 * The pieces are swapped in from the message thread; the audio thread never
 * waits for them and never frees them (collectGarbage does).
 */
class Sampler
{
public:
    static constexpr int firstNote = 36;
    /** The web app's CHOKE_FADE. */
    static constexpr double fadeSeconds = 0.003;

    struct Pieces
    {
        double rate = 44100.0;
        /** The tempo they were made in. */
        double bpm = 0.0;
        /** Which pieces these are: equal pieces, equal fingerprint (made by the page). */
        juce::String fingerprint;
        std::vector<std::array<std::vector<float>, 2>> sounds;
    };

    /** Message thread: plays these from now on; null takes them away. Sounding voices stop. */
    void setPieces (std::shared_ptr<const Pieces>);
    std::shared_ptr<const Pieces> getPieces() const;

    /** Audio thread: adds what the notes in `midi` play to `out`. */
    void process (juce::AudioBuffer<float>& out, const juce::MidiBuffer& midi, double hostRate);

    /** Message thread: frees pieces nothing plays any more. */
    void collectGarbage();

    /** The pieces as bytes for the song's state, and back; null when the bytes are not pieces. */
    static juce::MemoryBlock write (const Pieces&);
    static std::shared_ptr<const Pieces> read (const juce::MemoryBlock&);

private:
    struct Voice
    {
        int key = -1;
        size_t piece = 0;
        double position = 0.0; // seconds into the piece
        float level = 1.0f;
        int fadeLeft = -1;     // samples left of the fade out, or -1 when not fading
        bool active = false;
    };

    void noteOn (int key, float velocity, int fadeSamples);
    void noteOff (int key, int fadeSamples);
    void render (juce::AudioBuffer<float>& out, int from, int to, double hostRate, int fadeSamples);

    // Swapped under a lock the audio thread only tries: when it is taken, it plays on what it has.
    mutable juce::SpinLock currentLock;
    std::shared_ptr<const Pieces> current;
    std::shared_ptr<const Pieces> playing; // audio thread's own
    std::array<Voice, 64> voices;

    juce::CriticalSection retiredLock;
    std::vector<std::shared_ptr<const Pieces>> retired;
};
