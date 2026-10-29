#pragma once

#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

/** The web app in WebView2, served from the plugin itself, talking to the processor. */
class BreakseqEditor final : public juce::AudioProcessorEditor,
                             private juce::Timer
{
public:
    explicit BreakseqEditor (BreakseqProcessor&);
    ~BreakseqEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void saveFile (const juce::String& name, const juce::String& base64);

    BreakseqProcessor& processor;
    juce::WebBrowserComponent web;
    std::unique_ptr<juce::FileChooser> chooser;
    double sentBpm = 0.0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (BreakseqEditor)
};
