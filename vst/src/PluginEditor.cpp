#include "PluginEditor.h"

#include <BinaryData.h>

#include <cstring>

namespace
{
    /** The built web app (vst/web/dist), zipped into the plugin by the build. */
    juce::ZipFile& webZip()
    {
        static juce::MemoryInputStream stream { BinaryData::web_zip, (size_t) BinaryData::web_zipSize, false };
        static juce::ZipFile zip { stream };
        return zip;
    }

    const char* mimeFor (const juce::String& path)
    {
        static const std::unordered_map<juce::String, const char*> types {
            { "html", "text/html" }, { "js", "text/javascript" }, { "mjs", "text/javascript" }, { "css", "text/css" },
            { "json", "application/json" }, { "svg", "image/svg+xml" }, { "png", "image/png" }, { "ico", "image/vnd.microsoft.icon" },
            { "woff2", "font/woff2" }, { "woff", "font/woff" }, { "wasm", "application/wasm" },
        };
        const auto found = types.find (path.fromLastOccurrenceOf (".", false, false).toLowerCase());
        return found == types.end() ? "application/octet-stream" : found->second;
    }

    /** Serves the web app built into the plugin; nothing comes from the network. */
    std::optional<juce::WebBrowserComponent::Resource> resource (const juce::String& url)
    {
        auto path = url.upToFirstOccurrenceOf ("?", false, false).trimCharactersAtStart ("/");

        if (path.isEmpty())
            path = "index.html";

        auto& zip = webZip();
        const auto* entry = zip.getEntry (path);

        if (entry == nullptr)
            return std::nullopt;

        std::unique_ptr<juce::InputStream> in (zip.createStreamForEntry (*entry));

        if (in == nullptr)
            return std::nullopt;

        juce::MemoryBlock block;
        in->readIntoMemoryBlock (block);
        const auto* bytes = static_cast<const std::byte*> (block.getData());
        return juce::WebBrowserComponent::Resource { { bytes, bytes + block.getSize() }, mimeFor (path) };
    }
}

BreakseqEditor::BreakseqEditor (BreakseqProcessor& p)
    : AudioProcessorEditor (p),
      processor (p),
      web (juce::WebBrowserComponent::Options {}
               .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
               .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2 {}
                                            // WebView2 cannot write next to Reason in Program Files.
                                            .withUserDataFolder (juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                                                                     .getChildFile ("Breakseq")
                                                                     .getChildFile ("WebView2"))
                                            .withStatusBarDisabled())
               .withNativeIntegrationEnabled()
               .withResourceProvider (resource)
               .withNativeFunction ("hostInfo", [this] (const juce::Array<juce::var>&, auto complete)
                                    {
                                        auto* info = new juce::DynamicObject();
                                        info->setProperty ("bpm", processor.getBpm());
                                        info->setProperty ("sampleRate", processor.getMixer().rate());

                                        if (const auto pieces = processor.getSampler().getPieces())
                                        {
                                            auto* frozen = new juce::DynamicObject();
                                            frozen->setProperty ("fingerprint", pieces->fingerprint);
                                            frozen->setProperty ("bpm", pieces->bpm);
                                            frozen->setProperty ("count", (int) pieces->sounds.size());
                                            info->setProperty ("frozen", juce::var (frozen));
                                        }

                                        complete (juce::var (info));
                                    })
               .withNativeFunction ("loadProject", [this] (const juce::Array<juce::var>&, auto complete)
                                    {
                                        complete (processor.getProject());
                                    })
               .withNativeFunction ("saveProject", [this] (const juce::Array<juce::var>& args, auto complete)
                                    {
                                        processor.setProject (args[0].toString());
                                        complete (juce::var());
                                    })
               .withNativeFunction ("audio", [this] (const juce::Array<juce::var>& args, auto complete)
                                    {
                                        processor.getMixer().post (Mixer::parse (args[0]));
                                        complete (juce::var());
                                    })
               .withNativeFunction ("saveFile", [this] (const juce::Array<juce::var>& args, auto complete)
                                    {
                                        saveFile (args[0].toString(), args[1].toString());
                                        complete (juce::var());
                                    })
               .withNativeFunction ("freeze", [this] (const juce::Array<juce::var>& args, auto complete)
                                    {
                                        freeze (args[0]);
                                        complete (juce::var());
                                    })
               .withNativeFunction ("clip", [this] (const juce::Array<juce::var>& args, auto complete)
                                    {
                                        clip (args[0]);
                                        complete (juce::var());
                                    })
               .withNativeFunction ("clipStatus", [this] (const juce::Array<juce::var>& args, auto complete)
                                    {
                                        processor.status = args[0].toString();
                                        processor.busy = (bool) args[1];
                                        bar.refresh();
                                        complete (juce::var());
                                    })),
      bar (p, [this] (const juce::String& kind) { web.emitEventIfBrowserIsVisible ("songTo", kind); })
{
    addAndMakeVisible (web);
    addAndMakeVisible (bar);

    setResizable (true, true);
    setResizeLimits (800, 500, 3200, 2000);
    setSize (1280, 800);

    web.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
    startTimerHz (30);
}

BreakseqEditor::~BreakseqEditor()
{
    // The page and its player go with the window: what it played stops. (Claudes val)
    processor.getMixer().post ({ Mixer::Command {} });
}

void BreakseqEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff15171b));
}

void BreakseqEditor::resized()
{
    auto area = getLocalBounds();
    bar.setBounds (area.removeFromBottom (48));
    web.setBounds (area);
}

void BreakseqEditor::timerCallback()
{
    auto& mixer = processor.getMixer();

    auto* clock = new juce::DynamicObject();
    clock->setProperty ("time", mixer.now());
    clock->setProperty ("rate", mixer.rate());
    web.emitEventIfBrowserIsVisible ("clock", juce::var (clock));

    const auto ended = mixer.takeEnded();

    if (! ended.empty())
    {
        juce::Array<juce::var> ids;

        for (const auto id : ended)
            ids.add (id);

        auto* payload = new juce::DynamicObject();
        payload->setProperty ("ids", ids);
        web.emitEventIfBrowserIsVisible ("ended", juce::var (payload));
    }

    const auto bpm = processor.getBpm();

    if (bpm > 0.0 && bpm != sentBpm)
    {
        sentBpm = bpm;
        web.emitEventIfBrowserIsVisible ("tempo", bpm);
        bar.refresh();
    }

    processor.getSampler().collectGarbage();
}

namespace
{
    std::vector<float> floatsFrom (const juce::String& base64)
    {
        juce::MemoryOutputStream bytes;

        if (! juce::Base64::convertFromBase64 (bytes, base64))
            return {};

        std::vector<float> data (bytes.getDataSize() / sizeof (float));
        std::memcpy (data.data(), bytes.getData(), data.size() * sizeof (float));
        return data;
    }
}

void BreakseqEditor::freeze (const juce::var& payload)
{
    auto pieces = std::make_shared<Sampler::Pieces>();
    pieces->rate = (double) payload["rate"];
    pieces->bpm = (double) payload["bpm"];
    pieces->fingerprint = payload["fingerprint"].toString();

    if (const auto* sounds = payload["pieces"].getArray())
    {
        for (const auto& sound : *sounds)
        {
            std::array<std::vector<float>, 2> channels;
            const auto* parts = sound.getArray();

            if (parts == nullptr || parts->isEmpty())
                return;

            channels[0] = floatsFrom ((*parts)[0].toString());
            channels[1] = parts->size() > 1 ? floatsFrom ((*parts)[1].toString()) : channels[0];
            channels[1].resize (channels[0].size());
            pieces->sounds.push_back (std::move (channels));
        }
    }

    if (pieces->rate > 0.0)
        processor.getSampler().setPieces (std::move (pieces));

    bar.refresh();
}

void BreakseqEditor::clip (const juce::var& payload)
{
    const auto name = payload["field"].toString();
    const auto field = name == "audio" ? BreakseqProcessor::Field::audio : name == "midi" ? BreakseqProcessor::Field::midi : BreakseqProcessor::Field::space;

    if (! payload.hasProperty ("data"))
    {
        processor.setClip (field, {});
        bar.refresh();
        return;
    }

    juce::MemoryOutputStream bytes;

    if (! juce::Base64::convertFromBase64 (bytes, payload["data"].toString()))
        return;

    const auto folder = Clips::defaultFolder();
    folder.createDirectory();
    const auto file = folder.getChildFile (juce::File::createLegalFileName (payload["name"].toString()));

    if (file.replaceWithData (bytes.getData(), bytes.getDataSize()))
        processor.setClip (field, { file, payload["label"].toString() });

    bar.refresh();
}

DragField::DragField (BreakseqProcessor& p, BreakseqProcessor::Field f, juce::String emptyText)
    : processor (p), field (f), empty (std::move (emptyText))
{
}

void DragField::paint (juce::Graphics& g)
{
    const auto clip = processor.getClip (field);
    const auto ready = clip.file.existsAsFile();
    const auto box = getLocalBounds().toFloat().reduced (1.0f);

    g.setColour (juce::Colour (ready ? 0xff2b3a2f : 0xff202329));
    g.fillRoundedRectangle (box, 4.0f);
    g.setColour (juce::Colour (ready ? 0xff7fd17f : 0xff3a3f48));
    g.drawRoundedRectangle (box, 4.0f, 1.0f);
    g.setColour (ready ? juce::Colours::white : juce::Colour (0xff8a8f98));
    g.setFont (juce::FontOptions (12.0f));
    g.drawFittedText (ready ? clip.label : empty, getLocalBounds().reduced (8, 2), juce::Justification::centredLeft, 2);
}

void DragField::mouseDrag (const juce::MouseEvent&)
{
    const auto clip = processor.getClip (field);

    if (dragging || ! clip.file.existsAsFile())
        return;

    dragging = true;
    juce::DragAndDropContainer::performExternalDragDropOfFiles ({ clip.file.getFullPathName() }, false, this, [this] { dragging = false; });
}

ReasonBar::ReasonBar (BreakseqProcessor& p, std::function<void (const juce::String&)> songTo)
    : processor (p),
      audio (p, BreakseqProcessor::Field::audio, "Audio: press Song to Audio"),
      midi (p, BreakseqProcessor::Field::midi, "MIDI: press Song to MIDI"),
      space (p, BreakseqProcessor::Field::space, "No reverb/delay")
{
    toAudio.onClick = [songTo] { songTo ("audio"); };
    toMidi.onClick = [songTo] { songTo ("midi"); };
    toAudio.setTooltip ("The song as a WAV, to lay on an audio track in Reason");
    toMidi.setTooltip ("The song as MIDI, played by this instrument's frozen sounds, and its reverb/delay as a WAV");
    status.setFont (juce::FontOptions (12.0f));
    status.setColour (juce::Label::textColourId, juce::Colour (0xffb8bcc4));

    for (auto* c : std::initializer_list<juce::Component*> { &toAudio, &audio, &toMidi, &midi, &space, &status })
        addAndMakeVisible (c);

    refresh();
}

void ReasonBar::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff15171b));
    g.setColour (juce::Colour (0xff2a2e35));
    g.drawHorizontalLine (0, 0.0f, (float) getWidth());
}

void ReasonBar::resized()
{
    auto area = getLocalBounds().reduced (8, 7);
    toAudio.setBounds (area.removeFromLeft (110));
    area.removeFromLeft (6);
    audio.setBounds (area.removeFromLeft (150));
    area.removeFromLeft (16);
    toMidi.setBounds (area.removeFromLeft (110));
    area.removeFromLeft (6);
    midi.setBounds (area.removeFromLeft (230));
    area.removeFromLeft (6);
    space.setBounds (area.removeFromLeft (150));
    area.removeFromLeft (12);
    status.setBounds (area);
}

void ReasonBar::refresh()
{
    toAudio.setEnabled (! processor.busy);
    toMidi.setEnabled (! processor.busy);

    // The warning when Reason's tempo is not the one the frozen sounds were made in (Magnus beslut).
    const auto pieces = processor.getSampler().getPieces();
    const auto bpm = processor.getBpm();
    auto text = processor.status;
    auto colour = juce::Colour (0xffb8bcc4);

    if (pieces != nullptr && bpm > 0.0 && std::abs (bpm - pieces->bpm) > 1e-3)
    {
        text = "Reason is at " + juce::String (bpm, 2) + " BPM, the MIDI sounds were made at " + juce::String (pieces->bpm, 2) + " BPM: Song to MIDI again.";
        colour = juce::Colour (0xffe8b04a);
    }

    status.setText (text, juce::dontSendNotification);
    status.setColour (juce::Label::textColourId, colour);
    audio.repaint();
    midi.repaint();
    space.repaint();
}

void BreakseqEditor::saveFile (const juce::String& name, const juce::String& base64)
{
    auto bytes = std::make_shared<juce::MemoryOutputStream>();

    if (! juce::Base64::convertFromBase64 (*bytes, base64))
        return;

    chooser = std::make_unique<juce::FileChooser> ("Save", juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile (name),
                                                   "*" + name.fromLastOccurrenceOf (".", true, false));

    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting,
                          [bytes] (const juce::FileChooser& fc)
                          {
                              const auto file = fc.getResult();

                              if (file != juce::File())
                                  file.replaceWithData (bytes->getData(), bytes->getDataSize());
                          });
}
