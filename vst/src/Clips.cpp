#include "Clips.h"

namespace
{
    /** Every instance alive in Reason; they share the plugin's DLL. */
    juce::Array<const Clips*>& live()
    {
        static juce::Array<const Clips*> all;
        return all;
    }
}

Clips::Clips()
{
    live().add (this);
}

Clips::~Clips()
{
    for (const auto& file : retired)
        if (! usedByAnyone (file))
            file.deleteFile();

    live().removeFirstMatchingValue (this);
}

void Clips::set (size_t field, Clip clip)
{
    const auto old = clips[field].file;

    if (old != juce::File() && old != clip.file)
        retired.addIfNotAlreadyThere (old);

    retired.removeFirstMatchingValue (clip.file);
    clips[field] = std::move (clip);
}

bool Clips::usedByAnyone (const juce::File& file) const
{
    for (const auto* instance : live())
        for (const auto& clip : instance->clips)
            if (clip.file == file)
                return true;

    return false;
}
