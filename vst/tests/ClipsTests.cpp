#include "../src/Clips.h"

class ClipsTests final : public juce::UnitTest
{
public:
    ClipsTests() : juce::UnitTest ("Clips", "Breakseq") {}

    void runTest() override
    {
        const juce::TemporaryFile folderName;
        const auto folder = folderName.getFile();
        folder.createDirectory();

        const auto file = [&] (const juce::String& name)
        {
            auto f = folder.getChildFile (name);
            f.replaceWithText ("clip");
            return f;
        };

        beginTest ("a replaced file stays while the instance lives and goes with it");
        {
            const auto first = file ("first.wav");
            const auto second = file ("second.wav");
            {
                Clips clips;
                clips.set (0, { first, "Audio" });
                clips.set (0, { second, "Audio" });
                expect (first.existsAsFile());
            }
            expect (! first.existsAsFile());
            expect (second.existsAsFile(), "the field's own file is kept for the song");
        }

        beginTest ("a file another instance points at is kept");
        {
            const auto shared = file ("shared.mid");
            Clips duplicate;
            duplicate.restore (1, { shared, "MIDI" });
            {
                Clips clips;
                clips.restore (1, { shared, "MIDI" });
                clips.set (1, { file ("new.mid"), "MIDI" });
            }
            expect (shared.existsAsFile());
        }

        beginTest ("an emptied field retires its file; the same file again is not retired");
        {
            const auto space = file ("space.wav");
            const auto again = file ("again.wav");
            {
                Clips clips;
                clips.set (2, { space, "Reverb/delay" });
                clips.set (2, {});
                clips.set (0, { again, "Audio" });
                clips.set (0, { again, "Audio" });
            }
            expect (! space.existsAsFile());
            expect (again.existsAsFile());
        }

        beginTest ("restoring from the song retires nothing");
        {
            const auto saved = file ("saved.wav");
            {
                Clips clips;
                clips.restore (0, { saved, "Audio" });
                clips.restore (0, {});
            }
            expect (saved.existsAsFile());
        }

        folder.deleteRecursively();
    }
};

static ClipsTests clipsTests;
