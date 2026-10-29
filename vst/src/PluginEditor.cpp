#include "PluginEditor.h"
#include "MidiClip.h"

#include <BinaryData.h>

namespace
{
    constexpr int stripHeight = 44;

    /** Serves the page built into the plugin; nothing comes from the network. */
    std::optional<juce::WebBrowserComponent::Resource> resource (const juce::String& url)
    {
        if (url != "/" && url != "/index.html")
            return std::nullopt;

        const auto* bytes = reinterpret_cast<const std::byte*> (BinaryData::index_html);
        return juce::WebBrowserComponent::Resource { { bytes, bytes + BinaryData::index_htmlSize }, "text/html" };
    }

    juce::WebBrowserComponent::Options webOptions (BreakseqProcessor& processor)
    {
        // WebView2 cannot write next to Reason in Program Files, so its data goes in AppData.
        const auto userData = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                                  .getChildFile ("Breakseq")
                                  .getChildFile ("WebView2");

        return juce::WebBrowserComponent::Options {}
            .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
            .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2 {}
                                         .withUserDataFolder (userData)
                                         .withStatusBarDisabled())
            .withNativeIntegrationEnabled()
            .withResourceProvider (resource)
            .withNativeFunction ("hello", [] (const juce::Array<juce::var>& args, auto complete)
                                 {
                                     complete ("Hello " + args[0].toString() + ", from C++");
                                 })
            .withNativeFunction ("getState", [&processor] (const juce::Array<juce::var>&, auto complete)
                                 {
                                     auto* state = new juce::DynamicObject();
                                     state->setProperty ("bpm", processor.getBpm());
                                     state->setProperty ("sampleRate", processor.getSampleRate());
                                     state->setProperty ("counter", processor.getCounter());
                                     complete (juce::var (state));
                                 })
            .withNativeFunction ("setCounter", [&processor] (const juce::Array<juce::var>& args, auto complete)
                                 {
                                     processor.setCounter ((int) args[0]);
                                     complete (juce::var());
                                 })
            .withNativeFunction ("setSound", [&processor] (const juce::Array<juce::var>& args, auto complete)
                                 {
                                     std::vector<float> samples;

                                     if (const auto* values = args[0].getArray())
                                         for (const auto& v : *values)
                                             samples.push_back ((float) (double) v);

                                     const auto count = (int) samples.size();
                                     processor.setSound (std::move (samples));
                                     complete (count);
                                 });
    }
}

void DragMidi::paint (juce::Graphics& g)
{
    g.setColour (juce::Colour (0xff2b2f36));
    g.fillRoundedRectangle (getLocalBounds().toFloat().reduced (1.0f), 4.0f);
    g.setColour (juce::Colours::white);
    g.drawText ("Drag MIDI", getLocalBounds(), juce::Justification::centred);
}

void DragMidi::mouseDrag (const juce::MouseEvent&)
{
    if (dragging)
        return;

    dragging = true;
    const auto file = writeTestMidiClip (processor.getBpm());
    juce::DragAndDropContainer::performExternalDragDropOfFiles ({ file.getFullPathName() }, false, this,
                                                               [this] { dragging = false; });
}

BreakseqEditor::BreakseqEditor (BreakseqProcessor& p)
    : AudioProcessorEditor (p), processor (p), web (webOptions (p))
{
    addAndMakeVisible (web);
    addAndMakeVisible (dragMidi);
    addAndMakeVisible (saveButton);
    saveButton.onClick = [this] { saveMidi(); };

    setResizable (true, true);
    setResizeLimits (480, 320, 2400, 1600);
    setSize (720, 480);

    web.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
    startTimerHz (4);
}

void BreakseqEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff15171b));
}

void BreakseqEditor::resized()
{
    auto area = getLocalBounds();
    auto strip = area.removeFromBottom (stripHeight).reduced (6);
    web.setBounds (area);
    dragMidi.setBounds (strip.removeFromLeft (140));
    strip.removeFromLeft (8);
    saveButton.setBounds (strip.removeFromLeft (110));
}

void BreakseqEditor::timerCallback()
{
    const auto bpm = processor.getBpm();

    if (bpm != sentBpm)
    {
        sentBpm = bpm;
        web.emitEventIfBrowserIsVisible ("tempo", bpm);
    }
}

void BreakseqEditor::saveMidi()
{
    const auto bpm = processor.getBpm();
    const auto name = "breakseq-" + juce::String (juce::roundToInt (bpm)) + "bpm.mid";
    chooser = std::make_unique<juce::FileChooser> ("Save MIDI clip",
                                                   juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile (name),
                                                   "*.mid");

    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting,
                          [bpm] (const juce::FileChooser& fc)
                          {
                              const auto file = fc.getResult();

                              if (file == juce::File())
                                  return;

                              const auto clip = testMidiClip (bpm);
                              file.replaceWithData (clip.getData(), clip.getSize());
                          });
}
