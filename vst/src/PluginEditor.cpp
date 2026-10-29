#include "PluginEditor.h"

#include <BinaryData.h>

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
                                    }))
{
    addAndMakeVisible (web);

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
    web.setBounds (getLocalBounds());
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
    }
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
