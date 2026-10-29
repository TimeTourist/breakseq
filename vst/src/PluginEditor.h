#pragma once

#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

/** Drags the test MIDI clip out of the plugin as a .mid file, e.g. onto a track in Reason. */
class DragMidi final : public juce::Component
{
public:
    explicit DragMidi (BreakseqProcessor& p) : processor (p) {}

    void paint (juce::Graphics&) override;
    void mouseDrag (const juce::MouseEvent&) override;

private:
    BreakseqProcessor& processor;
    bool dragging = false;
};

/** The web page in WebView2 over a strip with Drag MIDI and Save .mid. */
class BreakseqEditor final : public juce::AudioProcessorEditor,
                             private juce::Timer
{
public:
    explicit BreakseqEditor (BreakseqProcessor&);

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void saveMidi();

    BreakseqProcessor& processor;
    juce::WebBrowserComponent web;
    DragMidi dragMidi { processor };
    juce::TextButton saveButton { "Save .mid" };
    std::unique_ptr<juce::FileChooser> chooser;
    double sentBpm = 0.0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (BreakseqEditor)
};
