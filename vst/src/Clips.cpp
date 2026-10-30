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

juce::File Clips::defaultFolder()
{
    return juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("Breakseq").getChildFile ("Clips");
}

Clips::Clips (juce::File clipsFolder) : folder (std::move (clipsFolder))
{
    live().add (this);
}

Clips::~Clips()
{
    for (const auto& file : retired)
        // Deleting a link removes the link, never what it points at.
        if (file.isAChildOf (folder) && ! usedByAnyone (file))
            file.deleteFile();

    live().removeFirstMatchingValue (this);
}

void Clips::set (size_t field, Clip clip)
{
    const auto old = clips[field].file;

    if (old.isAChildOf (folder) && old != clip.file)
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
