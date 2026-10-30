#pragma once

#include <juce_core/juce_core.h>

#include <array>

/**
 * The bar's drag fields and their files in AppData (docs/vst-spec.md, Lagring):
 * Song to Audio's WAV, Song to MIDI's MIDI file and its reverb/delay. A file a
 * new clip replaces is removed when this instance goes, if no other instance
 * in Reason points at it (Duplicate Device copies the fields); until then
 * Reason may still read it for a clip dragged but not yet saved in the song.
 * Message thread.
 */
class Clips final
{
public:
    static constexpr size_t fields = 3;

    /** A file ready to drag, and what its field says; an empty file is an empty field. */
    struct Clip
    {
        juce::File file;
        juce::String label;
    };

    Clips();
    ~Clips();

    Clip get (size_t field) const { return clips[field]; }
    /** A new clip in the field: the old file goes when this instance does. */
    void set (size_t field, Clip clip);
    /** The field as the song saved it; nothing is retired. */
    void restore (size_t field, Clip clip) { clips[field] = std::move (clip); }

private:
    bool usedByAnyone (const juce::File&) const;

    std::array<Clip, fields> clips;
    juce::Array<juce::File> retired;

    JUCE_DECLARE_NON_COPYABLE (Clips)
};
